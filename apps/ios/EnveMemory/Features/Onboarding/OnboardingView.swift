import SwiftUI

struct OnboardingView: View {
    var body: some View {
        NavigationStack {
            PairingForm(isReplacing: false) {}
                .toolbar(.hidden, for: .navigationBar)
        }
    }
}
