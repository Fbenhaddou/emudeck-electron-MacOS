// SPDX-License-Identifier: MIT
// Brings one manager-owned process (the Console Mode frontend) to the front after a
// game exits. Electron cannot activate another process, and the frontend has no
// focus-restoration code of its own. Only main invokes this; it activates nothing else.
//
// Usage: activate-app --pid <pid> --bundle <absolute .app path>
// Exit status: 0 frontmost, 2 macOS declined activation, 3 not yet registered as an
// application (just launched; retry), 1 invalid or unsafe request.
import AppKit
import Darwin

enum ActivationFailure: Error { case invalid, notReady }

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

/// Process identity that survives PID reuse: a recycled PID has a later start
/// time. (The kernel's unique-ID query is private SPI, so it is not used.)
func uniqueID(_ pid: pid_t) throws -> UInt64 {
    var info = kinfo_proc()
    var size = MemoryLayout<kinfo_proc>.stride
    var name: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, pid]
    try require(sysctl(&name, 4, &info, &size, nil, 0) == 0 && size > 0 && info.kp_proc.p_pid == pid)
    let start = info.kp_proc.p_starttime
    return UInt64(start.tv_sec) &* 1_000_000 &+ UInt64(start.tv_usec)
}

struct Target {
    let application: NSRunningApplication
    let pid: pid_t
    let unique: UInt64
    let bundle: String
}

/// Every check describes the same process: the unique ID is taken first and
/// re-checked after the others, so PID reuse between lookups is detected.
func verify(_ pid: pid_t, _ bundle: String, _ unique: UInt64) throws {
    try require(try ownerUID(pid) == geteuid())
    // The running executable must live inside the exact managed bundle.
    let executable = try canonicalPath(try executablePath(pid))
    try require(executable.hasPrefix(bundle + "/Contents/MacOS/"))
    try require(try uniqueID(pid) == unique)
}

func validatedApplication() throws -> Target {
    let args = CommandLine.arguments
    try require(args.count == 5 && args[1] == "--pid" && args[3] == "--bundle")
    try require(args[2].range(of: "^[1-9][0-9]{0,6}$", options: .regularExpression) != nil)
    guard let pid = pid_t(args[2]) else { throw ActivationFailure.invalid }
    try require(args[4].hasPrefix("/") && args[4].hasSuffix(".app"))
    let bundle = try canonicalPath(args[4])
    try require(bundle == args[4])
    let unique = try uniqueID(pid)
    try verify(pid, bundle, unique)
    // A freshly spawned process is verified above but may not have registered
    // with the window server yet; that is "not ready", not an invalid request.
    guard let candidate = NSRunningApplication(processIdentifier: pid),
        candidate.bundleURL != nil else { throw ActivationFailure.notReady }
    guard let application = Optional(candidate),
        application.processIdentifier == pid,
        !application.isTerminated,
        let bundleURL = application.bundleURL,
        try canonicalPath(bundleURL.path) == bundle else { throw ActivationFailure.invalid }
    try verify(pid, bundle, unique)
    return Target(application: application, pid: pid, unique: unique, bundle: bundle)
}

func isFrontmost(_ application: NSRunningApplication) -> Bool {
    NSWorkspace.shared.frontmostApplication?.processIdentifier == application.processIdentifier
}

func activate() throws -> Int32 {
    let target = try validatedApplication()
    let application = target.application
    for _ in 0..<3 {
        if application.isTerminated { return 1 }
        // Re-verify immediately before each activation request.
        do { try verify(target.pid, target.bundle, target.unique) } catch { return 1 }
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
catch ActivationFailure.notReady {
    exit(3)
}
catch {
    fputs("Activation request was refused as invalid.\n", stderr)
    exit(1)
}
