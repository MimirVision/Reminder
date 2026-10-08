// The only thing the mail engine knows about the network. On the phone it is react-native-tcp-socket (src/lib/rnSocket.ts);
// in tests it is Node's net/tls (testkit.ts). That keeps the whole IMAP/SMTP engine testable without a phone.

export interface MailSocket {
  write(data: string | Uint8Array): void;
  onData(cb: (chunk: Uint8Array) => void): void;
  // Called once, when the connection ends for any reason. `error` is set when it was not a clean close.
  onClose(cb: (error?: Error) => void): void;
  // Upgrade a plain connection to TLS (SMTP STARTTLS on port 587).
  startTls(): Promise<void>;
  close(): void;
}

export interface ConnectOptions {
  host: string;
  port: number;
  tls: boolean;
  timeoutMs?: number;
}

export type SocketConnector = (opts: ConnectOptions) => Promise<MailSocket>;
