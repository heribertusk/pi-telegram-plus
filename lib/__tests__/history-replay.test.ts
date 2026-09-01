import { describe, expect, it, vi } from "vitest";
import {
    buildTelegramHistoryReplay,
    replayTelegramHistory,
    type TelegramHistoryEntry,
} from "../history-replay.ts";
import type { TelegramTransport } from "../types.ts";

const entries: TelegramHistoryEntry[] = [
    { type: "message", message: { role: "user", content: "hello" } },
    {
        type: "message",
        message: {
            role: "assistant",
            content: [
                { type: "thinking", thinking: "considering the request" },
                { type: "toolCall", id: "call-ok", name: "read", arguments: { path: "README.md" } },
                { type: "toolCall", id: "call-fail", name: "bash", arguments: { command: "exit 1" } },
                { type: "text", text: "assistant answer" },
            ],
        },
    },
    {
        type: "message",
        message: {
            role: "toolResult",
            toolCallId: "call-ok",
            toolName: "read",
            isError: false,
            content: [{ type: "text", text: "successful tool output" }],
        },
    },
    {
        type: "message",
        message: {
            role: "toolResult",
            toolCallId: "call-fail",
            toolName: "bash",
            isError: true,
            content: [
                { type: "text", text: "Command failed" },
                { type: "image", data: "tool-image", mimeType: "image/png" },
            ],
        },
    },
    { type: "compaction" },
];

function textItems(replay: ReturnType<typeof buildTelegramHistoryReplay>): string {
    return replay.items.flatMap((item) => item.type === "text" ? [item.html] : []).join("\n");
}

describe("buildTelegramHistoryReplay", () => {
    it("replays the active branch messages while hiding configured details", () => {
        const replay = buildTelegramHistoryReplay(entries, { tool: "hidden", thinking: "hidden" });
        const text = textItems(replay);

        expect(replay.messageCount).toBe(4);
        expect(text).toContain("👤 User");
        expect(text).toContain("hello");
        expect(text).toContain("🤖 Assistant");
        expect(text).toContain("assistant answer");
        expect(text).not.toContain("considering the request");
        expect(text).not.toContain("successful tool output");
        expect(text).not.toContain("Command failed");
    });

    it("uses brief tool and thinking behavior including failed results only", () => {
        const replay = buildTelegramHistoryReplay(entries, { tool: "brief", thinking: "brief" });
        const text = textItems(replay);

        expect(text).toContain("considering the request");
        expect(text).toContain("README.md");
        expect(text).toContain("exit 1");
        expect(text).toContain("Command failed");
        expect(text).not.toContain("successful tool output");
        expect(replay.items.find((item) => item.type === "photo")).toBeUndefined();
    });

    it("includes complete tool results and images in full mode", () => {
        const replay = buildTelegramHistoryReplay(entries, { tool: "full", thinking: "full" });
        const text = textItems(replay);

        expect(text).toContain("Thinking");
        expect(text).toContain("successful tool output");
        expect(text).toContain("Command failed");
        expect(replay.items).toContainEqual({ type: "photo", data: "tool-image", caption: "bash output" });
    });
});

describe("history replay limit", () => {
    const turn = (i: number): TelegramHistoryEntry[] => [
        { type: "message", message: { role: "user", content: `question ${i}` } },
        {
            type: "message",
            message: {
                role: "assistant",
                content: [
                    { type: "toolCall", id: `call-${i}`, name: "read", arguments: { path: `file-${i}.md` } },
                    { type: "text", text: `answer ${i}` },
                ],
            },
        },
        {
            type: "message",
            message: {
                role: "toolResult",
                toolCallId: `call-${i}`,
                toolName: "read",
                isError: false,
                content: [{ type: "text", text: `output ${i}` }],
            },
        },
    ];
    const threeTurns = [turn(1), turn(2), turn(3)].flat();

    it("keeps only the last N user turns when replayLimit is set", () => {
        const replay = buildTelegramHistoryReplay(threeTurns, { tool: "full", replayLimit: 1 });
        const text = textItems(replay);

        expect(text).not.toContain("question 1");
        expect(text).not.toContain("question 2");
        expect(text).not.toContain("answer 1");
        expect(text).toContain("question 3");
        expect(text).toContain("answer 3");
        expect(text).toContain("output 3");
        expect(replay.messageCount).toBe(3);
        expect(replay.totalMessageCount).toBe(9);
    });

    it("returns only the banner when replayLimit is 0", () => {
        const replay = buildTelegramHistoryReplay(threeTurns, { replayLimit: 0 });

        expect(replay.items).toEqual([]);
        expect(replay.messageCount).toBe(0);
        expect(replay.totalMessageCount).toBe(9);
    });

    it("defaults to keeping everything when replayLimit is unset", () => {
        const replay = buildTelegramHistoryReplay(threeTurns, {});
        const text = textItems(replay);

        expect(text).toContain("question 1");
        expect(replay.messageCount).toBe(9);
        expect(replay.totalMessageCount).toBe(9);
    });

    it("does not crash on a toolResult whose toolCall was sliced away", () => {
        const orphaned: TelegramHistoryEntry[] = [
            ...turn(1),
            { type: "message", message: { role: "user", content: "question 2" } },
            {
                type: "message",
                message: {
                    role: "toolResult",
                    toolCallId: "call-1",
                    toolName: "bash",
                    isError: true,
                    content: [{ type: "text", text: "Command failed late" }],
                },
            },
        ];

        expect(() => buildTelegramHistoryReplay(orphaned, { tool: "brief", replayLimit: 1 })).not.toThrow();
        const replay = buildTelegramHistoryReplay(orphaned, { tool: "brief", replayLimit: 1 });
        const text = textItems(replay);
        expect(text).toContain("bash");
        expect(text).toContain("Command failed late");
    });

    it("annotates banner and completion when the replay was trimmed", async () => {
        const sent: string[] = [];
        const transport: TelegramTransport = {
            removeInlineKeyboard: async () => undefined,
            sendText: vi.fn(async (_chatId, text) => {
                sent.push(text);
                return [{ message_id: sent.length }];
            }),
            sendButtons: async () => ({ message_id: 1 }),
            editText: async () => undefined,
            editButtons: async () => undefined,
            answerCallbackQuery: async () => undefined,
            deleteMessage: async () => undefined,
            sendDocument: async () => undefined,
            sendPhoto: async () => undefined,
            sendChatAction: async () => undefined,
        };

        await replayTelegramHistory({
            entries: threeTurns,
            config: { tool: "hidden", replayLimit: 1 },
            transport,
            target: { chatId: 42 },
            instance: { cwd: "/w", model: "m", instanceId: "instance-b" },
        });

        expect(sent[0]).toContain("history:</b> 9 messages (showing last 3)");
        expect(sent.at(-1)).toContain("Adjust: /tg-config replay");
    });

    it("omits trim annotations when everything was replayed", async () => {
        const sent: string[] = [];
        const transport: TelegramTransport = {
            removeInlineKeyboard: async () => undefined,
            sendText: vi.fn(async (_chatId, text) => {
                sent.push(text);
                return [{ message_id: sent.length }];
            }),
            sendButtons: async () => ({ message_id: 1 }),
            editText: async () => undefined,
            editButtons: async () => undefined,
            answerCallbackQuery: async () => undefined,
            deleteMessage: async () => undefined,
            sendDocument: async () => undefined,
            sendPhoto: async () => undefined,
            sendChatAction: async () => undefined,
        };

        await replayTelegramHistory({
            entries: threeTurns,
            config: { tool: "hidden" },
            transport,
            target: { chatId: 42 },
            instance: { cwd: "/w", model: "m", instanceId: "instance-c" },
        });

        expect(sent[0]).toContain("history:</b> 9 messages");
        expect(sent[0]).not.toContain("showing last");
        expect(sent.at(-1)).not.toContain("Adjust:");
    });
});

describe("replayTelegramHistory", () => {
    it("sends a header, all replay items, and a completion marker in order", async () => {
        const sent: string[] = [];
        const transport: TelegramTransport = {
            removeInlineKeyboard: async () => undefined,
            sendText: vi.fn(async (_chatId, text) => {
                sent.push(text);
                return [{ message_id: sent.length }];
            }),
            sendButtons: async () => ({ message_id: 1 }),
            editText: async () => undefined,
            editButtons: async () => undefined,
            answerCallbackQuery: async () => undefined,
            deleteMessage: async () => undefined,
            sendDocument: async () => undefined,
            sendPhoto: async () => undefined,
            sendChatAction: async () => undefined,
        };

        const result = await replayTelegramHistory({
            entries: entries.slice(0, 2),
            config: { tool: "hidden", thinking: "hidden" },
            transport,
            target: { chatId: 42, messageThreadId: 7, sourceMessageId: 100 },
            instance: {
                cwd: "/workspace/project",
                sessionName: "demo",
                model: "provider/model",
                instanceId: "instance-a",
            },
        });

        expect(result).toMatchObject({ messageCount: 2, aborted: false });
        expect(sent[0]).toContain("Switched to demo");
        expect(sent[1]).toContain("👤 User");
        expect(sent).toContainEqual(expect.stringContaining("🤖 Assistant"));
        expect(sent.at(-1)).toContain("History replay complete");
    });
});
