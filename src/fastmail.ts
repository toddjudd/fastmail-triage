/**
 * Thin JMAP client for Fastmail (RFC 8620 / 8621).
 * Auth: API token from Settings > Privacy & Security > Integrations.
 */
const SESSION_URL = "https://api.fastmail.com/jmap/session";
const USING = ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"];

export interface Mailbox {
  id: string;
  name: string;
  role: string | null;
}

export interface EmailSummary {
  id: string;
  subject: string;
  from: { name: string | null; email: string }[];
  to: { name: string | null; email: string }[];
  receivedAt: string;
  keywords: Record<string, boolean>;
  mailboxIds: Record<string, boolean>;
  preview: string;
  body: string;
}

type Invocation = [string, Record<string, unknown>, string];

export class FastmailClient {
  private apiUrl = "";
  private accountId = "";
  private mailboxes: Mailbox[] = [];

  /** When readOnly is true, any write (Email/set) throws instead of reaching Fastmail. */
  constructor(
    private readonly token: string,
    private readonly readOnly = true,
  ) {}

  async connect(): Promise<void> {
    const res = await fetch(SESSION_URL, { headers: this.headers() });
    if (!res.ok) throw new Error(`Fastmail session failed: ${res.status}`);
    const session = (await res.json()) as {
      apiUrl: string;
      primaryAccounts: Record<string, string>;
    };
    this.apiUrl = session.apiUrl;
    const accountId = session.primaryAccounts["urn:ietf:params:jmap:mail"];
    if (!accountId) throw new Error("No JMAP mail account on this token");
    this.accountId = accountId;

    const [[, mb]] = (await this.call([
      ["Mailbox/get", { accountId, properties: ["id", "name", "role"] }, "m"],
    ])) as [[string, { list: Mailbox[] }, string]];
    this.mailboxes = mb.list;
  }

  /** Find a mailbox by role (e.g. "inbox", "archive", "trash") or by name. */
  mailbox(roleOrName: string): Mailbox {
    const key = roleOrName.toLowerCase();
    const found =
      this.mailboxes.find((m) => m.role === key) ??
      this.mailboxes.find((m) => m.name.toLowerCase() === key);
    if (!found) throw new Error(`Mailbox not found: ${roleOrName}`);
    return found;
  }

  async listEmails(opts: {
    mailbox: string;
    unreadOnly: boolean;
    limit: number;
    maxBodyChars: number;
  }): Promise<EmailSummary[]> {
    const filter: Record<string, unknown> = { inMailbox: this.mailbox(opts.mailbox).id };
    if (opts.unreadOnly) filter.notKeyword = "$seen";

    const responses = await this.call([
      [
        "Email/query",
        {
          accountId: this.accountId,
          filter,
          sort: [{ property: "receivedAt", isAscending: false }],
          limit: opts.limit,
        },
        "q",
      ],
      [
        "Email/get",
        {
          accountId: this.accountId,
          "#ids": { resultOf: "q", name: "Email/query", path: "/ids" },
          properties: [
            "id", "subject", "from", "to", "receivedAt",
            "keywords", "mailboxIds", "preview", "textBody", "bodyValues",
          ],
          fetchTextBodyValues: true,
          maxBodyValueBytes: opts.maxBodyChars,
        },
        "g",
      ],
    ]);

    const get = responses[1]?.[1] as { list: Array<Record<string, any>> };
    return get.list.map((e) => ({
      id: e.id,
      subject: e.subject ?? "",
      from: e.from ?? [],
      to: e.to ?? [],
      receivedAt: e.receivedAt,
      keywords: e.keywords ?? {},
      mailboxIds: e.mailboxIds ?? {},
      preview: e.preview ?? "",
      body: (e.textBody ?? [])
        .map((p: { partId: string }) => e.bodyValues?.[p.partId]?.value ?? "")
        .join("\n")
        .slice(0, opts.maxBodyChars),
    }));
  }

  /** Apply a JMAP patch (e.g. `{"keywords/$seen": true}`) to one email. */
  async patch(emailId: string, patch: Record<string, unknown>): Promise<void> {
    if (this.readOnly) throw new Error("Refusing to write: Fastmail client is read-only");
    const [[, result]] = (await this.call([
      ["Email/set", { accountId: this.accountId, update: { [emailId]: patch } }, "s"],
    ])) as [[string, { notUpdated?: Record<string, unknown> }, string]];
    if (result.notUpdated?.[emailId]) {
      throw new Error(`Email/set failed: ${JSON.stringify(result.notUpdated[emailId])}`);
    }
  }

  private async call(methodCalls: Invocation[]): Promise<Invocation[]> {
    const res = await fetch(this.apiUrl, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ using: USING, methodCalls }),
    });
    if (!res.ok) throw new Error(`JMAP request failed: ${res.status} ${await res.text()}`);
    const { methodResponses } = (await res.json()) as { methodResponses: Invocation[] };
    for (const [name, args] of methodResponses) {
      if (name === "error") throw new Error(`JMAP error: ${JSON.stringify(args)}`);
    }
    return methodResponses;
  }

  private headers() {
    return { Authorization: `Bearer ${this.token}` };
  }
}
