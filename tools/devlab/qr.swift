import Foundation
import CoreImage
import AppKit
let text = try String(contentsOfFile: CommandLine.arguments[1], encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
let filter = CIFilter(name: "CIQRCodeGenerator")!
filter.setValue(Data(text.utf8), forKey: "inputMessage")
filter.setValue("M", forKey: "inputCorrectionLevel")
let output = filter.outputImage!
let padded = output.extent.insetBy(dx: -4, dy: -4)
let white = CIImage(color: CIColor.white).cropped(to: padded)
let code = output.composited(over: white).transformed(by: CGAffineTransform(scaleX: 8, y: 8))
let cg = CIContext().createCGImage(code, from: code.extent)!
let bitmap = NSBitmapImageRep(cgImage: cg)
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[2]))
