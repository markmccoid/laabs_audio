import AppIntents
import SwiftUI
import UIKit

struct AssistantBookCard: View {
  let book: AssistantBookEntity

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 12) {
        snippetCover(book: book, size: 56)
        VStack(alignment: .leading, spacing: 5) {
          Text(book.title).font(.headline).lineLimit(2)
          if let author = book.author {
            Text(author).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
          }
          ProgressView(value: book.progressPercent)
          Text(statusText).font(.caption).foregroundStyle(.secondary)
        }
      }
      snippetActions(book)
    }
    .padding()
  }

  private var statusText: String {
    let progress = "\(Int((book.progressPercent * 100).rounded()))%"
    return book.isDownloaded ? "\(progress) · downloaded" : progress
  }
}

struct AssistantBookList: View {
  let books: [AssistantBookEntity]

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      ForEach(Array(books.prefix(AssistantSearchCopy.displayedBookLimit))) { book in
        HStack(spacing: 10) {
          snippetCover(book: book, size: 40)
          VStack(alignment: .leading, spacing: 2) {
            Text(book.title).font(.headline).lineLimit(1)
            if let author = book.author {
              Text(author).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
          }
          Spacer(minLength: 0)
          Text("\(Int((book.progressPercent * 100).rounded()))%")
            .font(.caption.monospacedDigit())
            .foregroundStyle(.secondary)
        }
        snippetActions(book)
      }
    }
    .padding()
  }
}

struct AssistantResultSnippet: View {
  let heading: String
  let books: [AssistantBookEntity]

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(heading).font(.headline)
      if books.count == 1, let book = books.first {
        AssistantBookCard(book: book)
      } else if !books.isEmpty {
        AssistantBookList(books: books)
      }
    }
  }
}

@ViewBuilder
private func snippetCover(book: AssistantBookEntity, size: CGFloat) -> some View {
  let cover = AssistantCover(book: book, size: size)
  if #available(iOS 26.0, *) {
    Button(intent: OpenAssistantBookActionIntent(book: book)) {
      cover
    }
    .buttonStyle(.plain)
  } else {
    cover
  }
}

@ViewBuilder
private func snippetActions(_ book: AssistantBookEntity) -> some View {
  if #available(iOS 26.0, *) {
    HStack(spacing: 8) {
      Button(intent: PlayAudiobookIntent(book: book)) {
        Text("Play")
      }
      .buttonStyle(.borderedProminent)
      Button(intent: OpenAssistantBookActionIntent(book: book)) {
        Text("Open")
      }
      .buttonStyle(.bordered)
    }
  }
}

private struct AssistantCover: View {
  let book: AssistantBookEntity
  let size: CGFloat

  var body: some View {
    Group {
      if let coverPath = book.coverPath,
        let image = UIImage(contentsOfFile: coverPath)
      {
        Image(uiImage: image).resizable()
      } else if let coverURL = book.coverURL, let url = URL(string: coverURL) {
        AsyncImage(url: url) { phase in
          if let image = phase.image {
            image.resizable()
          } else {
            placeholder
          }
        }
      } else {
        placeholder
      }
    }
    .scaledToFill()
    .frame(width: size, height: size)
    .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
  }

  private var placeholder: some View {
    ZStack {
      Color.secondary.opacity(0.15)
      Image(systemName: "book.closed.fill").foregroundStyle(.secondary)
    }
  }
}
