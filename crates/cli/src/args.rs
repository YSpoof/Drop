//! Command-line arguments: long flags only, pt-BR usage, path classification.

use std::ffi::OsString;
use std::path::PathBuf;

use clap::error::{ContextKind, ContextValue, ErrorKind};
use clap::{ArgAction, Parser};
use drop_core::signaling::normalize_code;

use crate::text;

#[derive(Parser)]
#[command(name = "dropcli", disable_help_flag = true, override_help = text::USAGE)]
struct Cli {
    #[arg(long)]
    quick: bool,
    #[arg(long)]
    host: bool,
    #[arg(long, value_name = "PIN")]
    code: Option<String>,
    #[arg(long, value_name = "DIR")]
    out: Option<PathBuf>,
    #[arg(long, action = ArgAction::Help)]
    help: Option<bool>,
    paths: Vec<PathBuf>,
}

/// Session role picked on the command line.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Role {
    Host,
    Join(String),
}

/// Validated launch options.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Launch {
    pub quick: bool,
    pub role: Option<Role>,
    /// Download directory for this run only.
    pub out: Option<PathBuf>,
    /// Regular files to send once, in argument order.
    pub files: Vec<PathBuf>,
    /// Directories to watch.
    pub dirs: Vec<PathBuf>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ArgsError {
    /// `--help`: print usage, exit 0.
    Help,
    /// Malformed command line: print the message and usage, exit 1.
    Usage(String),
    /// Well-formed but invalid input: print the message, exit 1.
    Invalid(String),
}

/// Parses process arguments (the first item is the program name).
pub fn parse<I, T>(args: I) -> Result<Launch, ArgsError>
where
    I: IntoIterator<Item = T>,
    T: Into<OsString> + Clone,
{
    let cli = Cli::try_parse_from(args).map_err(clap_error)?;
    let role = match (cli.host, cli.code) {
        (true, Some(_)) => return Err(ArgsError::Usage(text::ERR_HOST_AND_CODE.into())),
        (true, None) => Some(Role::Host),
        (false, Some(code)) => match normalize_code(&code) {
            Some(code) => Some(Role::Join(code.into())),
            None => return Err(ArgsError::Invalid(text::invalid_pin())),
        },
        (false, None) => None,
    };
    if cli.quick && role.is_none() {
        return Err(ArgsError::Usage(text::ERR_QUICK_NEEDS_ROLE.into()));
    }
    let (files, dirs) = classify(cli.paths)?;
    Ok(Launch {
        quick: cli.quick,
        role,
        out: cli.out,
        files,
        dirs,
    })
}

fn clap_error(err: clap::Error) -> ArgsError {
    if err.kind() == ErrorKind::DisplayHelp {
        return ArgsError::Help;
    }
    match err.get(ContextKind::InvalidArg) {
        Some(ContextValue::String(arg)) => ArgsError::Usage(text::invalid_arg(arg)),
        _ => ArgsError::Usage(text::ERR_ARGS.into()),
    }
}

/// Splits paths into regular files and directories; anything else is an error.
fn classify(paths: Vec<PathBuf>) -> Result<(Vec<PathBuf>, Vec<PathBuf>), ArgsError> {
    let (mut files, mut dirs) = (Vec::new(), Vec::new());
    for path in paths {
        let meta = std::fs::metadata(&path)
            .map_err(|err| ArgsError::Invalid(text::path_missing(path.display(), err)))?;
        if meta.is_dir() {
            dirs.push(path);
        } else if meta.is_file() {
            files.push(path);
        } else {
            return Err(ArgsError::Invalid(text::path_unsupported(path.display())));
        }
    }
    Ok((files, dirs))
}

#[cfg(test)]
#[path = "args_tests.rs"]
mod tests;
