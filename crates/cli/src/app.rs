//! Mode selection and the interactive flow: arguments → quick mode, or one [`Ui`] for the whole
//! process (donation reminder → menu → session wait → inbox). Exit code 0 on success and on a
//! confirmed cancel; any other failure prints `erro: …` after the terminal is restored.

use std::ffi::OsString;
use std::fmt;
use std::io::{self, IsTerminal, Write};
use std::process::ExitCode;
use std::sync::{Arc, Mutex};

use tokio::sync::mpsc;

use crate::args::{self, ArgsError, Launch, Role};
use crate::config::{self, Store};
use crate::device::Device;
use crate::rtc::RtcConfig;
use crate::session::{self, Options, Outcome};
use crate::signaling::url_from_env;
use crate::state::{Command, Phase, SessionState, Shared};
use crate::text;
use crate::ui::donation::Donation;
use crate::ui::host_wait::{HostWait, HostWaitScreen};
use crate::ui::inbox::Inbox;
use crate::ui::menu::{Menu, MenuChoice};
use crate::ui::settings::Settings;
use crate::ui::{Exit, Ui, quick, system_clipboard};

#[derive(Debug)]
pub enum Error {
    Config(io::Error),
    Runtime(io::Error),
    Terminal(io::Error),
    NotATerminal,
    Donation(io::Error),
    Session(session::Error),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            Self::Config(err) => f.write_str(&text::err_load_config(err)),
            Self::Runtime(err) => err.fmt(f),
            Self::Terminal(err) => f.write_str(&text::err_tui(err)),
            Self::NotATerminal => f.write_str(text::ERR_NOT_A_TERMINAL),
            Self::Donation(err) => f.write_str(&text::err_dismiss_donation(err)),
            Self::Session(err) => err.fmt(f),
        }
    }
}

impl std::error::Error for Error {}

/// The whole program: parse, run, report.
pub fn main(args: impl IntoIterator<Item = OsString>) -> ExitCode {
    let launch = match parse(args, &mut io::stdout(), &mut io::stderr()) {
        Ok(launch) => launch,
        Err(code) => return code,
    };
    let result = tokio::runtime::Runtime::new()
        .map_err(Error::Runtime)
        .and_then(|runtime| runtime.block_on(run(launch)));
    report(result, &mut io::stderr())
}

/// Validated arguments, or the exit code after printing help or the argument error.
pub fn parse(
    args: impl IntoIterator<Item = OsString>,
    out: &mut impl Write,
    err: &mut impl Write,
) -> Result<Launch, ExitCode> {
    let failure = match args::parse(args) {
        Ok(launch) => return Ok(launch),
        Err(ArgsError::Help) => {
            let _ = writeln!(out, "{}", text::USAGE);
            return Err(ExitCode::SUCCESS);
        }
        Err(ArgsError::Usage(msg)) => format!("{msg}\n\n{}", text::USAGE),
        Err(ArgsError::Invalid(msg)) => msg,
    };
    let _ = writeln!(err, "{} {failure}", text::ERR_PREFIX);
    Err(ExitCode::FAILURE)
}

/// 0 on success (a confirmed cancel is a success); `erro: …` and 1 otherwise.
pub fn report(result: Result<(), Error>, err: &mut impl Write) -> ExitCode {
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(failure) => {
            let _ = writeln!(err, "{} {failure}", text::ERR_PREFIX);
            ExitCode::FAILURE
        }
    }
}

pub async fn run(launch: Launch) -> Result<(), Error> {
    let mut store = Store::load(config::default_path().map_err(Error::Config)?);
    // Best effort: a config that cannot be written must not block a transfer.
    let _ = store.record_visit();
    match (launch.quick, launch.role.clone()) {
        (true, Some(role)) => {
            let opts = options(&launch, role, &store, false);
            quick::run(opts, Arc::new(Mutex::new(store)), system_clipboard()).await
        }
        (_, role) => interactive(&launch, role, store).await,
    }
}

/// Session options for `role`; `manual` is the interactive inbox (no auto-download).
pub fn options(launch: &Launch, role: Role, store: &Store, manual: bool) -> Options {
    Options {
        role,
        signaling_url: url_from_env(),
        device: Device::new(&store.config().device_name),
        download_dir: store.download_dir(launch.out.as_deref()),
        manual,
        files: launch.files.clone(),
        dirs: launch.dirs.clone(),
        rtc: RtcConfig::default(),
    }
}

async fn interactive(launch: &Launch, role: Option<Role>, mut store: Store) -> Result<(), Error> {
    if !(io::stdin().is_terminal() && io::stdout().is_terminal()) {
        return Err(Error::NotATerminal);
    }
    let mut ui = Ui::start(system_clipboard()).map_err(Error::Terminal)?;
    let role = match role {
        Some(role) => role,
        None => match choose(&mut ui, &mut store).await? {
            Some(role) => role,
            None => return Ok(()),
        },
    };
    let opts = options(launch, role, &store, true);
    let outcome = session_ui(&mut ui, opts, store).await;
    drop(ui);
    if let Ok(Outcome::Bye) = outcome {
        println!("{}", text::PEER_CLOSED_SESSION);
    }
    outcome.map(drop)
}

/// Donation reminder when due, then the menu until host or join; `None` on cancel.
async fn choose(ui: &mut Ui, store: &mut Store) -> Result<Option<Role>, Error> {
    loop {
        if let Some(mut donation) = Donation::when_due(store) {
            match ui.run(&mut donation).await.map_err(Error::Terminal)? {
                Exit::Done(saved) => saved.map_err(Error::Donation)?,
                Exit::Cancelled => return Ok(None),
            }
        }
        let choice = ui.run(&mut Menu::new()).await.map_err(Error::Terminal)?;
        let settings = match choice {
            Exit::Done(MenuChoice::Host) => return Ok(Some(Role::Host)),
            Exit::Done(MenuChoice::Join(pin)) => return Ok(Some(Role::Join(pin))),
            Exit::Cancelled => return Ok(None),
            Exit::Done(MenuChoice::Settings) => ui.run(&mut Settings::new(store)).await,
        };
        if settings.map_err(Error::Terminal)? == Exit::Cancelled {
            return Ok(None);
        }
    }
}

/// Runs the session in a task under the wait screen and the inbox. Any UI exit quits the
/// session, which then discards partials and says `bye`.
async fn session_ui(ui: &mut Ui, opts: Options, store: Store) -> Result<Outcome, Error> {
    let host = opts.role == Role::Host;
    let state = Shared::new(SessionState::default());
    let (commands, rx) = mpsc::channel(16);
    let session = spawn_session(opts, state.clone(), store, rx);
    let redraw = ui.redraw_handle();
    let mut changes = state.subscribe();
    let wake = tokio::spawn(async move {
        while changes.changed().await.is_ok() {
            redraw.notify_one();
        }
    });
    let shown = screens(ui, &state, host, commands.clone()).await;
    wake.abort();
    let _ = commands.send(Command::Quit).await;
    let outcome = session
        .await
        .unwrap_or_else(|err| std::panic::resume_unwind(err.into_panic()));
    shown.map_err(Error::Terminal)?;
    outcome.map_err(Error::Session)
}

/// The session task; the phase is `Ended` once it returns, also after an early error.
fn spawn_session(
    opts: Options,
    state: Shared,
    store: Store,
    commands: mpsc::Receiver<Command>,
) -> tokio::task::JoinHandle<Result<Outcome, session::Error>> {
    tokio::spawn(async move {
        let outcome =
            session::run(opts, state.clone(), Arc::new(Mutex::new(store)), commands).await;
        state.send_modify(|s| s.phase = Phase::Ended);
        outcome
    })
}

async fn screens(
    ui: &mut Ui,
    state: &Shared,
    host: bool,
    commands: mpsc::Sender<Command>,
) -> io::Result<()> {
    let mut feed = state.subscribe();
    let wait = HostWaitScreen::new(move || HostWait::from(&*feed.borrow_and_update()));
    let mut wait = match host {
        true => wait,
        false => wait.titled(text::JOIN_SESSION),
    };
    if ui.run(&mut wait).await? == Exit::Cancelled || state.borrow().phase == Phase::Ended {
        return Ok(());
    }
    ui.run(&mut Inbox::new(state.subscribe(), commands)).await?;
    Ok(())
}

#[cfg(test)]
#[path = "app_tests.rs"]
mod tests;
