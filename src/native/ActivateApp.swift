// SPDX-License-Identifier: MIT
// Brings one manager-owned process (the Console Mode frontend) to the front after a
// game exits. Electron cannot activate another process, and the frontend has no
// focus-restoration code of its own. Only main invokes this; it activates nothing else.
//
// Usage: activate-app --pid <pid> --bundle <absolute .app path>
// Exit status: 0 frontmost, 2 macOS declined activation, 1 invalid or unsafe request.
import AppKit
import Darwin

enum ActivationFailure: Error { case invalid }

func require(_ condition: Bool) throws {
    if !condition { throw ActivationFailure.invalid }
}

func canonicalPath(_ path: String) throws -> String {
    guard let resolved = Darwin.realpath(path, nil) else { throw ActivationFailure.invalid }
    defer { free(resolved) }
    return String(cString: resolved)
}

func ownerUID(_ pid: pid_t) throws -> uid_t {
    var info = kinfo_proc()
    var size = MemoryLayout<kinfo_proc>.stride
    var name: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, pid]
    try require(sysctl(&name, 4, &info, &size, nil, 0) == 0 && size > 0)
    return info.kp_eproc.e_ucred.cr_uid
}

func executablePath(_ pid: pid_t) throws -> String {
    var buffer = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN))
    try require(proc_pidpath(pid, &buffer, UInt32(buffer.count)) > 0)
    return String(cString: buffer)
}

func validatedApplication() throws -> NSRunningApplication {
    let args = CommandLine.arguments
    try require(args.count == 5 && args[1] == "--pid" && args[3] == "--bundle")
    try require(args[2].range(of: "^[1-9][0-9]{0,6}$", options: .regularExpression) != nil)
    guard let pid = pid_t(args[2]) else { throw ActivationFailure.invalid }
    try require(args[4].hasPrefix("/") && args[4].hasSuffix(".app"))
    let bundle = try canonicalPath(args[4])
    try require(bundle == args[4])
    try require(try ownerUID(pid) == geteuid())
    // The running executable must live inside the exact managed bundle.
    let executable = try canonicalPath(try executablePath(pid))
    try require(executable.hasPrefix(bundle + "/Contents/MacOS/"))
    guard let application = NSRunningApplication(processIdentifier: pid),
        !application.isTerminated,
        let bundleURL = application.bundleURL,
        try canonicalPath(bundleURL.path) == bundle else { throw ActivationFailure.invalid }
    return application
}

func isFrontmost(_ application: NSRunningApplication) -> Bool {
    NSWorkspace.shared.frontmostApplication?.processIdentifier == application.processIdentifier
}

func activate() throws -> Int32 {
    let application = try validatedApplication()
    for _ in 0..<3 {
        if application.isTerminated { return 1 }
        _ = application.activate(options: [.activateAllWindows])
        // Poll for up to 0.5s per attempt; activation is asynchronous.
        for _ in 0..<10 {
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.05))
            if isFrontmost(application) { return 0 }
        }
    }
    return 2
}

do { exit(try activate()) }
catch {
    fputs("Activation request was refused as invalid.\n", stderr)
    exit(1)
}
