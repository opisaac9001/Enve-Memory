import EnveMemoryKit
import SwiftUI

struct TaskRow: View {
    let task: Item
    var showsProject = false
    let isCompleting: Bool
    let onComplete: () -> Void
    let onOpen: () -> Void

    @Environment(\.hearth) private var hearth

    var body: some View {
        HStack(alignment: .top, spacing: HearthSpacing.md) {
            Button(action: onComplete) {
                Image(systemName: isDone ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 22, weight: .regular))
                    .foregroundStyle(isDone ? hearth.accent : hearth.textTertiary)
                    .frame(width: 34, height: 34)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(isDone || isCompleting)
            .accessibilityLabel(isDone ? "Completed" : "Complete \(task.title)")

            Button(action: onOpen) {
                VStack(alignment: .leading, spacing: HearthSpacing.xs) {
                    Text(task.title)
                        .font(HearthFont.body)
                        .foregroundStyle(isDone ? hearth.textTertiary : hearth.textPrimary)
                        .strikethrough(isDone, color: hearth.textTertiary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if let details { details }
                }
                .padding(.top, 6)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .padding(.vertical, HearthSpacing.xs)
    }

    private var isDone: Bool { isCompleting || task.task?.status.isFinished == true }

    private var details: Text? {
        var parts: [Text] = []
        if let fields = task.task {
            if fields.priority == .high {
                parts.append(Text(Image(systemName: "flag.fill")).foregroundColor(hearth.danger) + Text(" High"))
            }
            if let due = fields.dueDate {
                parts.append(Text(Image(systemName: "calendar")) + Text(" ") + Text(DueFormat.label(due)).foregroundColor(DueFormat.color(due, hearth)))
            }
        }
        if showsProject, let project = task.project { parts.append(Text(project.name)) }
        guard let first = parts.first else { return nil }
        return parts.dropFirst().reduce(first) { $0 + Text("  ·  ") + $1 }
            .font(HearthFont.caption)
            .foregroundColor(hearth.textSecondary)
    }
}

enum DueFormat {
    static func label(_ date: Date, calendar: Calendar = .current) -> String {
        if calendar.isDateInToday(date) { return "Today" }
        if calendar.isDateInTomorrow(date) { return "Tomorrow" }
        if calendar.isDateInYesterday(date) { return "Yesterday" }
        let sameYear = calendar.component(.year, from: date) == calendar.component(.year, from: .now)
        return date.formatted(sameYear ? .dateTime.weekday(.abbreviated).month(.abbreviated).day() : .dateTime.month(.abbreviated).day().year())
    }

    static func color(_ date: Date, _ hearth: HearthPalette, calendar: Calendar = .current) -> Color {
        if calendar.isDateInToday(date) { return hearth.accent }
        return date < calendar.startOfDay(for: .now) ? hearth.danger : hearth.textSecondary
    }
}

/// Completes a task through the outbox so it still lands when offline.
struct TaskCompleter {
    let outbox: OutboxService
    let router: Router

    func complete(_ task: Item) async -> Bool {
        let outcome = await outbox.submit(.completeTask(task.id), kind: .task, title: "Complete “\(task.title)”")
        return router.report(outcome, sent: "Completed “\(task.title)”")
    }
}
