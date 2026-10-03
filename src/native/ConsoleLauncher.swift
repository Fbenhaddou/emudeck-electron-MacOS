// SPDX-License-Identifier: MIT
// A bounded ES-DE wait client. It never resolves ROM paths or starts an emulator.
import Foundation
import CryptoKit
import CoreFoundation
import Darwin

enum LaunchFailure: Error { case unavailable }

func require(_ condition: Bool) throws {
    if !condition { throw LaunchFailure.unavailable }
}

func metadata(_ path: String) throws -> stat {
    var info = stat()
    try require(lstat(path, &info) == 0)
    return info
}

func matches(_ text: String, _ pattern: String) -> Bool {
    text.range(of: pattern, options: .regularExpression) != nil
}

func canonicalPath(_ path: String) throws -> String {
    // Foundation may normalize /private/tmp back to /tmp on macOS. Match the
    // manager's POSIX realpath contract exactly, including the private prefix.
    guard let resolved = Darwin.realpath(path, nil) else { throw LaunchFailure.unavailable }
    defer { free(resolved) }
    return String(cString: resolved)
}

func trueBoolean(_ value: Any?) -> Bool {
    guard let number = value as? NSNumber,
        CFGetTypeID(number) == CFBooleanGetTypeID() else { return false }
    return number.boolValue
}

func integer(_ value: Any?) -> Int? {
    guard let number = value as? NSNumber,
        CFGetTypeID(number) != CFBooleanGetTypeID(),
        number.doubleValue.isFinite,
        number.doubleValue >= 0 && number.doubleValue <= 255 else { return nil }
    let result = number.intValue
    return number.doubleValue == Double(result) ? result : nil
}

func readKey(_ root: String) throws -> SymmetricKey {
    let descriptor = open(root + "/key", O_RDONLY | O_NOFOLLOW)
    try require(descriptor >= 0)
    defer { Darwin.close(descriptor) }
    var info = stat()
    try require(fstat(descriptor, &info) == 0)
    try require(info.st_uid == geteuid() && info.st_nlink == 1 &&
        (info.st_mode & S_IFMT) == S_IFREG && (info.st_mode & 0o777) == 0o600 && info.st_size == 64)
    var buffer = [UInt8](repeating: 0, count: 65)
    var count = 0
    while count < 64 {
        let received = buffer.withUnsafeMutableBytes {
            Darwin.read(descriptor, $0.baseAddress!.advanced(by: count), 64 - count)
        }
        try require(received > 0)
        count += received
    }
    try require(Darwin.read(descriptor, &buffer[64], 1) == 0)
    let encoded = String(decoding: buffer.prefix(64), as: UTF8.self)
    try require(matches(encoded, "^[a-f0-9]{64}$"))
    let chars = Array(encoded.utf8)
    let decoded = stride(from: 0, to: chars.count, by: 2).map {
        UInt8(String(decoding: chars[$0...($0 + 1)], as: UTF8.self), radix: 16)!
    }
    return SymmetricKey(data: Data(decoded))
}

func receiveFrame(_ descriptor: Int32) throws -> [String: Any] {
    var collected = Data()
    var buffer = [UInt8](repeating: 0, count: 1024)
    while !collected.contains(10) {
        let count = recv(descriptor, &buffer, buffer.count, 0)
        try require(count > 0 && collected.count + count <= 4096)
        collected.append(contentsOf: buffer.prefix(count))
    }
    try require(collected.last == 10 && collected.filter { $0 == 10 }.count == 1)
    try require(collected.count > 1)
    let object = try JSONSerialization.jsonObject(with: collected.dropLast())
    guard let frame = object as? [String: Any] else { throw LaunchFailure.unavailable }
    return frame
}

func sendFrame(_ descriptor: Int32, _ frame: [String: Any]) throws {
    var data = try JSONSerialization.data(withJSONObject: frame)
    data.append(10)
    var sent = 0
    while sent < data.count {
        let count = data.withUnsafeBytes {
            send(descriptor, $0.baseAddress!.advanced(by: sent), data.count - sent, 0)
        }
        try require(count > 0)
        sent += count
    }
}

func launch() throws -> Int32 {
    let args = CommandLine.arguments
    try require(args.count == 5 && args[1] == "--session" && args[3] == "--game")
    let root = args[2]
    try require(matches(root, "^/[A-Za-z0-9_./-]+$") &&
        root == (try canonicalPath(root)) &&
        (root + "/s").utf8.count <= 100)
    let info = try metadata(root)
    try require(info.st_uid == geteuid() && (info.st_mode & S_IFMT) == S_IFDIR &&
        (info.st_mode & 0o777) == 0o700)
    let prefix = root + "/roms/gc/"
    try require(args[4].hasPrefix(prefix))
    let marker = String(args[4].dropFirst(prefix.count))
    try require(matches(marker, "^[a-f0-9]{32}\\.ewgame$"))
    let gameID = String(marker.prefix(32))
    let markerInfo = try metadata(args[4])
    try require((markerInfo.st_mode & S_IFMT) == S_IFREG && markerInfo.st_size == 0 &&
        markerInfo.st_uid == geteuid() && markerInfo.st_nlink == 1 &&
        args[4] == (try canonicalPath(args[4])))
    let key = try readKey(root)
    let socketInfo = try metadata(root + "/s")
    try require((socketInfo.st_mode & S_IFMT) == S_IFSOCK && socketInfo.st_uid == geteuid() &&
        (socketInfo.st_mode & 0o777) == 0o600)
    let descriptor = socket(AF_UNIX, SOCK_STREAM, 0)
    try require(descriptor >= 0)
    defer { Darwin.close(descriptor) }
    var noSigPipe: Int32 = 1
    try require(setsockopt(descriptor, SOL_SOCKET, SO_NOSIGPIPE, &noSigPipe,
        socklen_t(MemoryLayout<Int32>.size)) == 0)
    var timeout = timeval(tv_sec: 5, tv_usec: 0)
    try require(setsockopt(descriptor, SOL_SOCKET, SO_RCVTIMEO, &timeout,
        socklen_t(MemoryLayout<timeval>.size)) == 0)
    try require(setsockopt(descriptor, SOL_SOCKET, SO_SNDTIMEO, &timeout,
        socklen_t(MemoryLayout<timeval>.size)) == 0)
    var address = sockaddr_un()
    address.sun_family = sa_family_t(AF_UNIX)
    address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
    let name = Array((root + "/s").utf8) + [0]
    withUnsafeMutableBytes(of: &address.sun_path) { storage in
        storage.initializeMemory(as: UInt8.self, repeating: 0)
        storage.copyBytes(from: name)
    }
    let connected = withUnsafePointer(to: &address) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
            Darwin.connect(descriptor, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
        }
    }
    try require(connected == 0)
    let challenge = try receiveFrame(descriptor)
    try require(Set(challenge.keys) == Set(["schema", "challenge"]) &&
        integer(challenge["schema"]) == 1)
    guard let nonce = challenge["challenge"] as? String,
        matches(nonce, "^[a-f0-9]{64}$") else { throw LaunchFailure.unavailable }
    let proof = HMAC<SHA256>.authenticationCode(for: Data((nonce + "\n" + gameID).utf8), using: key)
        .map { String(format: "%02x", $0) }.joined()
    try sendFrame(descriptor, ["schema": 1, "id": gameID, "proof": proof])
    // Signal the end of the single request before the manager validates it.
    try require(shutdown(descriptor, SHUT_WR) == 0)
    // The frontend's output pipe stays open for the lifetime of this client.
    // No execution timeout or disconnect handler kills the manager-owned game.
    timeout.tv_sec = 0
    try require(setsockopt(descriptor, SOL_SOCKET, SO_RCVTIMEO, &timeout,
        socklen_t(MemoryLayout<timeval>.size)) == 0)
    let result = try receiveFrame(descriptor)
    try require(Set(result.keys) == Set(["ok", "code", "signal"]) &&
        trueBoolean(result["ok"]))
    guard let code = integer(result["code"]), result["signal"] is NSNull
        else { throw LaunchFailure.unavailable }
    return Int32(code)
}

do { exit(try launch()) }
catch {
    fputs("Managed game launch is unavailable. Return to Emulation Workspace.\n", stderr)
    exit(1)
}
