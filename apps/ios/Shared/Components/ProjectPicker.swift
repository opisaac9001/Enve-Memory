import EnveMemoryKit
import SwiftUI

struct ProjectPicker: View {
    @Binding var projectID: String?
    let projects: [ProjectRef]

    @Environment(\.hearth) private var hearth

    var body: some View {
        Menu {
            Button("No project") { projectID = nil }
            ForEach(projects, id: \.id) { project in
                Button(project.name) { projectID = project.id }
            }
        } label: {
            HStack {
                Image(systemName: "folder").foregroundStyle(hearth.accent)
                Text(projects.first { $0.id == projectID }?.name ?? "No project")
                    .foregroundStyle(hearth.textPrimary)
                Spacer()
                Image(systemName: "chevron.up.chevron.down").font(.footnote).foregroundStyle(hearth.textTertiary)
            }
            .hearthField()
        }
        .accessibilityLabel("Project")
        .accessibilityValue(projects.first { $0.id == projectID }?.name ?? "None")
    }
}
