fn main() {
    if let Err(error) = fredy_health_route::run() {
        eprintln!("health route failed: {error}");
        std::process::exit(1);
    }
}
