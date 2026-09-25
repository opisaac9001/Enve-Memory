// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "EnveMemoryKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "EnveMemoryKit", targets: ["EnveMemoryKit"]),
    ],
    targets: [
        .target(name: "EnveMemoryKit"),
        .testTarget(
            name: "EnveMemoryKitTests",
            dependencies: ["EnveMemoryKit"],
            resources: [.copy("Fixtures")]
        ),
    ],
    swiftLanguageModes: [.v6]
)
