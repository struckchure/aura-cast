//! Wire format for AuraCast UDP packets.
//!
//! Every packet starts with a fixed 20-byte header:
//!
//! | bytes  | field                                            |
//! |--------|--------------------------------------------------|
//! | 0..4   | magic `AURA`                                     |
//! | 4      | protocol version                                 |
//! | 5      | packet kind                                      |
//! | 6..8   | stream id (random per broadcast session)         |
//! | 8..12  | sequence number (audio packets)                  |
//! | 12..20 | sample position at 48 kHz (audio packets)        |
//!
//! Audio packets carry one 20 ms Opus frame (48 kHz stereo) as payload.
//! Receivers send `Subscribe` to a sender every second as a keepalive and
//! `Unsubscribe` when they disconnect.

pub const MAGIC: &[u8; 4] = b"AURA";
pub const VERSION: u8 = 1;
pub const HEADER_LEN: usize = 20;

pub const SAMPLE_RATE: u32 = 48_000;
pub const CHANNELS: usize = 2;
/// 20 ms at 48 kHz
pub const FRAME_SAMPLES: usize = 960;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Audio = 1,
    Subscribe = 2,
    Unsubscribe = 3,
}

impl Kind {
    fn from_u8(v: u8) -> Option<Self> {
        match v {
            1 => Some(Kind::Audio),
            2 => Some(Kind::Subscribe),
            3 => Some(Kind::Unsubscribe),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct Header {
    pub kind: Kind,
    pub stream_id: u16,
    pub seq: u32,
    pub sample_pos: u64,
}

pub fn encode(header: &Header, payload: &[u8], out: &mut Vec<u8>) {
    out.clear();
    out.extend_from_slice(MAGIC);
    out.push(VERSION);
    out.push(header.kind as u8);
    out.extend_from_slice(&header.stream_id.to_be_bytes());
    out.extend_from_slice(&header.seq.to_be_bytes());
    out.extend_from_slice(&header.sample_pos.to_be_bytes());
    out.extend_from_slice(payload);
}

pub fn decode(buf: &[u8]) -> Option<(Header, &[u8])> {
    if buf.len() < HEADER_LEN || &buf[0..4] != MAGIC || buf[4] != VERSION {
        return None;
    }
    let header = Header {
        kind: Kind::from_u8(buf[5])?,
        stream_id: u16::from_be_bytes([buf[6], buf[7]]),
        seq: u32::from_be_bytes(buf[8..12].try_into().ok()?),
        sample_pos: u64::from_be_bytes(buf[12..20].try_into().ok()?),
    };
    Some((header, &buf[HEADER_LEN..]))
}

pub fn control(kind: Kind) -> Vec<u8> {
    let mut out = Vec::with_capacity(HEADER_LEN);
    encode(
        &Header {
            kind,
            stream_id: 0,
            seq: 0,
            sample_pos: 0,
        },
        &[],
        &mut out,
    );
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip() {
        let header = Header {
            kind: Kind::Audio,
            stream_id: 0xBEEF,
            seq: 42,
            sample_pos: 123_456_789,
        };
        let mut buf = Vec::new();
        encode(&header, &[1, 2, 3], &mut buf);
        let (h, payload) = decode(&buf).unwrap();
        assert_eq!(h.kind, Kind::Audio);
        assert_eq!(h.stream_id, 0xBEEF);
        assert_eq!(h.seq, 42);
        assert_eq!(h.sample_pos, 123_456_789);
        assert_eq!(payload, &[1, 2, 3]);
    }

    #[test]
    fn rejects_garbage() {
        assert!(decode(b"hello world, not a packet").is_none());
        assert!(decode(b"AURA").is_none());
    }
}
