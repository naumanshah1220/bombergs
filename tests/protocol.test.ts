import { describe, expect, it } from 'vitest';
import { ROOM_ALPHABET, controllerUrl, hostPeerId, roomCode } from '../src/shared/protocol';

describe('roomCode', () => {
  it('produces 4 chars from the confusion-free alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = roomCode();
      expect(code).toHaveLength(4);
      for (const ch of code) expect(ROOM_ALPHABET).toContain(ch);
    }
  });

  it('never contains I or O', () => {
    expect(ROOM_ALPHABET).not.toMatch(/[IO]/);
  });
});

describe('hostPeerId', () => {
  it('lowercases and prefixes the room code', () => {
    expect(hostPeerId('ABCD')).toBe('bombergs-abcd');
  });
});

describe('controllerUrl', () => {
  it('builds the QR join URL', () => {
    expect(controllerUrl('https://192.168.1.5:5173', 'WXYZ')).toBe(
      'https://192.168.1.5:5173/controller.html?room=WXYZ',
    );
  });
});
