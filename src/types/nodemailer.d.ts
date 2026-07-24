declare module 'nodemailer' {
  interface SendMailOptions {
    from?: string | { name?: string; address: string };
    to?: string;
    subject?: string;
    text?: string;
    html?: string;
  }

  interface Transporter {
    verify?(): Promise<unknown>;
    sendMail(options: SendMailOptions): Promise<unknown>;
  }

  function createTransport(options: unknown): Transporter;

  const nodemailer: {
    createTransport: typeof createTransport;
  };

  export default nodemailer;
  export { Transporter, SendMailOptions, createTransport };
}
