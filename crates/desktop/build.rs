fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=assets/icon.ico");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }
    // FileVersion and ProductVersion default to CARGO_PKG_VERSION.
    winresource::WindowsResource::new()
        .set_icon("assets/icon.ico")
        .set("ProductName", "Drop")
        .set("FileDescription", "Drop desktop")
        .compile()
        .expect("embed Windows resources");
}
