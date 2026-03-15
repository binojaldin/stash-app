import Foundation

let args = Array(CommandLine.arguments.dropFirst())
guard !args.isEmpty else {
    fputs("Usage: icloud_helper <file_path> [file_path ...]\n", stderr)
    exit(1)
}

let fm = FileManager.default

for path in args {
    let url = URL(fileURLWithPath: path)
    do {
        try fm.startDownloadingUbiquitousItem(at: url)
        print("OK")
    } catch {
        print("ERR:\(error.localizedDescription)")
    }
}
