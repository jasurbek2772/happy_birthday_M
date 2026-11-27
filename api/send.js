// Уведомления в VK о действиях на сайте.
// Переменные окружения Vercel: VK_BOT_TOKEN, VK_USER_ID

// Разрешённые события. Текст собирается на сервере,
// поэтому посторонний не сможет слать тебе произвольные сообщения.
const EVENTS = {
    visit: "👀 Сайт открыли",
    gate: "⏰ Таймер дошёл до нуля, показан экран с кодом",
    wrong: "❌ Неверный код",
    success: "💌 Код верный, письмо открыто!",
    late: "🔓 Вечерняя часть письма открылась прямо у неё на экране"
};

function formatTime() {
    return new Date().toLocaleString("ru-RU", {
        timeZone: "Asia/Krasnoyarsk",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    });
}

export default async function handler(req, res) {
    // Preflight (на случай кросс-доменных запросов)
    if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
        return res.status(200).end();
    }

    // Только POST
    if (req.method !== "POST") {
        return res.status(405).json({
            success: false,
            error: "Method not allowed"
        });
    }

    try {
        // Если Vercel не распарсил JSON, читаем тело вручную
        let body = req.body;
        if (!body || typeof body !== "object" || Array.isArray(body)) {
            const raw = await new Promise((resolve, reject) => {
                let data = "";
                req.on("data", chunk => (data += chunk));
                req.on("end", () => resolve(data));
                req.on("error", reject);
            });
            try {
                body = raw ? JSON.parse(raw) : {};
            } catch (e) {
                console.error("Body parse error:", e, "raw:", raw);
                body = {};
            }
        }

        const { event, extra } = body || {};

        // Проверяем событие
        if (typeof event !== "string" || !EVENTS[event]) {
            return res.status(400).json({
                success: false,
                error: "Unknown event"
            });
        }

        // Собираем текст сообщения
        let text = EVENTS[event];
        if (typeof extra === "string" && extra.trim()) {
            text += ": " + extra.trim().slice(0, 100);
        }
        text += "\n🕐 " + formatTime() + " (Красноярск)";
        const ua = String(req.headers["user-agent"] || "").slice(0, 120);
        if (ua) text += "\n📱 " + ua;

        // Переменные окружения Vercel
        const TOKEN = process.env.VK_BOT_TOKEN;
        const USER_ID = process.env.VK_USER_ID;

        if (!TOKEN || !USER_ID) {
            console.error(
                "VK environment variables are missing: VK_BOT_TOKEN / VK_USER_ID"
            );
            return res.status(500).json({
                success: false,
                error: "Server configuration error: missing VK_BOT_TOKEN or VK_USER_ID"
            });
        }

        // Параметры VK API
        const params = new URLSearchParams();
        params.append("access_token", TOKEN);
        params.append("user_id", String(USER_ID));
        params.append("message", text);
        params.append(
            "random_id",
            String(Math.floor(Math.random() * 2147483647))
        );
        params.append("v", "5.131");

        // Запрос в VK с таймаутом
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);

        let response;
        try {
            response = await fetch(
                "https://api.vk.com/method/messages.send",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded"
                    },
                    body: params.toString(),
                    signal: controller.signal
                }
            );
        } finally {
            clearTimeout(timeout);
        }

        const data = await response.json().catch(() => null);

        // HTTP ошибка
        if (!response.ok) {
            console.error("VK HTTP error:", response.status, data);
            return res.status(502).json({
                success: false,
                error: "VK HTTP error",
                status: response.status
            });
        }

        // Ошибка самого VK API (неверный токен, чат не начат и т.д.)
        if (!data || data.error) {
            console.error("VK API error:", data && data.error);
            return res.status(400).json({
                success: false,
                error:
                    (data && data.error && data.error.error_msg) ||
                    "VK API error",
                error_code: data && data.error && data.error.error_code
            });
        }

        console.log("VK message sent:", data.response);
        return res.status(200).json({
            success: true,
            result: data.response
        });
    } catch (error) {
        console.error("Server error:", error);
        return res.status(500).json({
            success: false,
            error: error?.message || "Internal server error"
        });
    }
}

