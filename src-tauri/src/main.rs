// En release no abre consola en Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    ferro_launcher_lib::run()
}
