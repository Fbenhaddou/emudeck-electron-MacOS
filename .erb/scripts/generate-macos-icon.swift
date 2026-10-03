#!/usr/bin/env swift
// Original development artwork. No external images, symbol assets, or fonts.
// Run from the repository root: swift .erb/scripts/generate-macos-icon.swift
// In a restricted workspace, add: -module-cache-path /private/tmp/emulation-workspace-icon-swift-module-cache
// Optional arguments: --output-dir <directory> --preview <64px PNG path>
// This script regenerates both the vector source and its bitmap from fixed geometry.
import AppKit
import CoreGraphics
import Foundation

var outputDirectory = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
    .appendingPathComponent("assets", isDirectory: true)
var previewPath: URL?
var arguments = Array(CommandLine.arguments.dropFirst())
while !arguments.isEmpty {
    let argument = arguments.removeFirst()
    guard !arguments.isEmpty else { fatalError("Missing value for \(argument)") }
    let value = URL(fileURLWithPath: arguments.removeFirst())
    switch argument {
    case "--output-dir": outputDirectory = value
    case "--preview": previewPath = value
    default: fatalError("Unknown argument: \(argument)")
    }
}

let svg = """
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" role="img" aria-labelledby="title description">
  <title id="title">Emulation Workspace development icon</title>
  <desc id="description">An original layered library tile with a play symbol on a blue rounded square.</desc>
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#4ba6ff"/>
      <stop offset="1" stop-color="#0e3d96"/>
    </linearGradient>
    <linearGradient id="card" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fbfdff"/>
      <stop offset="1" stop-color="#e1edfc"/>
    </linearGradient>
    <linearGradient id="play" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#188aff"/>
      <stop offset="1" stop-color="#0457b9"/>
    </linearGradient>
    <filter id="tileShadow" x="-20%" y="-20%" width="140%" height="150%">
      <feDropShadow dx="0" dy="18" stdDeviation="14" flood-color="#06245c" flood-opacity=".24"/>
    </filter>
    <filter id="cardShadow" x="-20%" y="-20%" width="140%" height="150%">
      <feDropShadow dx="0" dy="12" stdDeviation="13" flood-color="#07285d" flood-opacity=".18"/>
    </filter>
  </defs>
  <rect x="80" y="80" width="864" height="864" rx="192" fill="url(#tile)" filter="url(#tileShadow)"/>
  <rect x="81" y="81" width="862" height="862" rx="191" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="2"/>
  <rect x="298" y="238" width="428" height="442" rx="72" fill="#fff" fill-opacity=".28"/>
  <rect x="236" y="338" width="552" height="410" rx="76" fill="url(#card)" filter="url(#cardShadow)"/>
  <circle cx="512" cy="545" r="94" fill="url(#play)"/>
  <path d="M487 494 L564 545 L487 596 Z" fill="#fff" stroke="#fff" stroke-width="10" stroke-linejoin="round"/>
</svg>
"""

func color(_ hex: UInt32, alpha: CGFloat = 1) -> CGColor {
    CGColor(srgbRed: CGFloat((hex >> 16) & 255) / 255,
            green: CGFloat((hex >> 8) & 255) / 255,
            blue: CGFloat(hex & 255) / 255, alpha: alpha)
}
func rounded(_ x: CGFloat, _ y: CGFloat, _ width: CGFloat, _ height: CGFloat,
             _ radius: CGFloat) -> CGPath {
    CGPath(roundedRect: CGRect(x: x, y: y, width: width, height: height),
           cornerWidth: radius, cornerHeight: radius, transform: nil)
}
let space = CGColorSpace(name: CGColorSpace.sRGB)!
guard let context = CGContext(data: nil, width: 1024, height: 1024,
                              bitsPerComponent: 8, bytesPerRow: 1024 * 4,
                              space: space,
                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
    fatalError("Could not allocate icon bitmap")
}
context.translateBy(x: 0, y: 1024)
context.scaleBy(x: 1, y: -1)
context.setAllowsAntialiasing(true)

func gradient(_ path: CGPath, top: UInt32, bottom: UInt32,
              from: CGFloat, to: CGFloat) {
    let paint = CGGradient(colorsSpace: space, colors: [color(top), color(bottom)] as CFArray,
                           locations: [0, 1])!
    context.saveGState()
    context.addPath(path)
    context.clip()
    context.drawLinearGradient(paint, start: CGPoint(x: 512, y: from),
                               end: CGPoint(x: 512, y: to), options: [])
    context.restoreGState()
}
func shadow(_ path: CGPath, fill: CGColor, offset: CGFloat, blur: CGFloat,
            opacity: CGFloat, tint: UInt32 = 0x06245c) {
    context.saveGState()
    context.setShadow(offset: CGSize(width: 0, height: -offset), blur: blur,
                      color: color(tint, alpha: opacity))
    context.addPath(path)
    context.setFillColor(fill)
    context.fillPath()
    context.restoreGState()
}

let tile = rounded(80, 80, 864, 864, 192)
shadow(tile, fill: color(0x0e3d96), offset: 18, blur: 28, opacity: 0.24)
gradient(tile, top: 0x4ba6ff, bottom: 0x0e3d96, from: 80, to: 944)
context.addPath(rounded(81, 81, 862, 862, 191))
context.setStrokeColor(color(0xffffff, alpha: 0.12))
context.setLineWidth(2)
context.strokePath()
context.addPath(rounded(298, 238, 428, 442, 72))
context.setFillColor(color(0xffffff, alpha: 0.28))
context.fillPath()
let card = rounded(236, 338, 552, 410, 76)
shadow(card, fill: color(0xfbfdff), offset: 12, blur: 26, opacity: 0.18, tint: 0x07285d)
gradient(card, top: 0xfbfdff, bottom: 0xe1edfc, from: 338, to: 748)
let play = CGPath(ellipseIn: CGRect(x: 418, y: 451, width: 188, height: 188), transform: nil)
gradient(play, top: 0x188aff, bottom: 0x0457b9, from: 451, to: 639)
context.move(to: CGPoint(x: 487, y: 494))
context.addLine(to: CGPoint(x: 564, y: 545))
context.addLine(to: CGPoint(x: 487, y: 596))
context.closePath()
context.setFillColor(color(0xffffff))
context.setStrokeColor(color(0xffffff))
context.setLineWidth(10)
context.setLineJoin(.round)
context.drawPath(using: .fillStroke)

func savePNG(_ image: CGImage, at url: URL) throws {
    let bitmap = NSBitmapImageRep(cgImage: image)
    guard let bytes = bitmap.representation(using: .png, properties: [:]) else {
        fatalError("PNG encoding failed")
    }
    try bytes.write(to: url, options: .atomic)
}
guard let icon = context.makeImage() else { fatalError("Icon rendering failed") }
try FileManager.default.createDirectory(at: outputDirectory, withIntermediateDirectories: true)
try svg.appending("\n").write(to: outputDirectory.appendingPathComponent("macos-development-icon.svg"),
                             atomically: true, encoding: .utf8)
try savePNG(icon, at: outputDirectory.appendingPathComponent("macos-development-icon.png"))
if let previewPath {
    let preview = CGContext(data: nil, width: 64, height: 64, bitsPerComponent: 8,
                            bytesPerRow: 64 * 4, space: space,
                            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    preview.interpolationQuality = .high
    preview.draw(icon, in: CGRect(x: 0, y: 0, width: 64, height: 64))
    try savePNG(preview.makeImage()!, at: previewPath)
}
print("Generated original macOS development SVG and 1024px PNG in \(outputDirectory.path)")
