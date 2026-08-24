use sp1_build::build_program_with_args;

/// Builds the SP1 guest ELF (../guest) for the RISC-V zkVM target so the host
/// can embed it with `include_elf!`.
fn main() {
    build_program_with_args("../guest", Default::default());
}
