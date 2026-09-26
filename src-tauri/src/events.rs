//! Events the streaming engine reports to the UI (or to a test harness).

use crate::receiver::ReceiverStats;
use crate::sender::SenderStats;
use std::sync::Arc;

pub enum Event {
    SenderStats(SenderStats),
    ReceiverStats(ReceiverStats),
    StreamError(String),
}

pub type EventSink = Arc<dyn Fn(Event) + Send + Sync>;

pub fn tauri_sink(app: tauri::AppHandle) -> EventSink {
    use tauri::Emitter;
    Arc::new(move |event| {
        let _ = match event {
            Event::SenderStats(stats) => app.emit("sender-stats", stats),
            Event::ReceiverStats(stats) => app.emit("receiver-stats", stats),
            Event::StreamError(message) => app.emit("stream-error", message),
        };
    })
}
