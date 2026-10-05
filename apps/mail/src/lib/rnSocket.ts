import TcpSocket from 'react-native-tcp-socket';
import { utf8Encode } from '../core/bytes.ts';
import type { ConnectOptions, MailSocket, SocketConnector } from '../core/socket.ts';

// The phone's side of core/socket.ts: a real TCP connection, with TLS from the first byte for IMAP (port 993).
export const rnConnector: SocketConnector = ({ host, port, tls, timeoutMs }: ConnectOptions) =>
  new Promise<MailSocket>((resolve, reject) => {
    let onData: (c: Uint8Array) => void = () => {};
    let onClose: (e?: Error) => void = () => {};
    let lastError: Error | undefined;
    let connected = false;
    const sock = TcpSocket.createConnection({ host, port, tls, tlsCheckValidity: true, connectTimeout: timeoutMs ?? 15000 }, () => {
      connected = true;
      resolve({
        write: (d) => void sock.write(typeof d === 'string' ? d : d),
        onData: (cb) => (onData = cb),
        onClose: (cb) => (onClose = cb),
        startTls: () => Promise.reject(new Error('STARTTLS is added together with sending mail.')),
        close: () => void sock.destroy(),
      });
    });
    sock.on('data', (d) => onData(typeof d === 'string' ? utf8Encode(d) : new Uint8Array(d)));
    sock.on('error', (e) => {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (!connected) reject(lastError);
    });
    sock.on('close', () => {
      if (!connected) reject(lastError ?? new Error('Could not connect.'));
      else onClose(lastError);
    });
  });
