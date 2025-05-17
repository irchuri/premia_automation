// Полный актуальный скрипт для бонусов и отправки сводки

const POST_URL = "https://discord.com/api/webhooks/WEBHOOK_ID_1";         // Webhook для личных премий
const SUMMARY_WEBHOOK_URL = "https://discord.com/api/webhooks/WEBHOOK_ID_2"; // Webhook для сводки
const SERVER_ID = "DISCORD_SERVER_ID";
const CHANNEL_ID = "DISCORD_CHANNEL_ID";
const BONUS_GIF = "https://tenor.com/gif_link"; // можно убрать, если не хотите гифку в конце embed
const MAX_BONUS = 100000; // максимальный размер премии
const MAX_FIELD_LENGTH = 1024; // ограничение по количеству символов в одном emded-блоке дискорда
const LOGSHEET_ID = "ID_гугл_таблицы_для_логов";
const FORM_ID = "id_гугл_формы";

const SCORING_RULES = {
    "Задача" : 123  // "БУКВАЛЬНЫЙ ВОПРОС ИЗ ГУГЛ-ФОРМЫ" : стоимость
};
const VISIBLE_FIELDS = ["Ваше имя и фамилия", "Ваш статик", "Ваш ранг", "Ваша работа"];

function onSubmit(e) {
    try {
        const formResponse = e.response;
        const itemResponses = formResponse.getItemResponses();
        let totalBonus = 0;
        const discordFields = [];
        let workFieldParts = [];

        itemResponses.forEach(response => {
            const question = response.getItem().getTitle();
            const answer = response.getResponse();

            if (SCORING_RULES[question] !== undefined) {
                const numericValue = extractNumber(answer);
                totalBonus += numericValue * SCORING_RULES[question];
            }

            if (VISIBLE_FIELDS.includes(question)) {
                if (question === "Ваша работа" && answer && answer.length > MAX_FIELD_LENGTH) {
                    workFieldParts = splitLongText(answer);
                    discordFields.push({ name: `**${question}**`, value: workFieldParts[0], inline: false });
                } else {
                    discordFields.push({ name: `**${question}**`, value: answer || "-", inline: false });
                }
            }
        });

        if (workFieldParts.length > 1) {
            for (let i = 1; i < workFieldParts.length; i++) {
                if (discordFields.length >= 25) break;
                if (workFieldParts[i] && workFieldParts[i].trim().length > 0) {
                    discordFields.push({ name: "", value: workFieldParts[i], inline: false });
                }
            }
        }

        const finalBonus = Math.min(totalBonus, MAX_BONUS);
        discordFields.push({ name: "**Итоговая премия**", value: `${finalBonus}`, inline: false });

        const payload = {
            content: "",
            embeds: [
                {
                    color: 4108341,
                    fields: discordFields,
                    footer: { text: "by irchuri <3" },
                    timestamp: new Date().toISOString(),
                    image: { url: BONUS_GIF }
                }
            ]
        };

        const discordResponse = UrlFetchApp.fetch(POST_URL + '?wait=true', {
            method: "post",
            headers: { "Content-Type": "application/json" },
            payload: JSON.stringify(payload),
            muteHttpExceptions: false
        });

        const messageId = JSON.parse(discordResponse.getContentText()).id;
        const discordMessageUrl = `https://discord.com/channels/${SERVER_ID}/${CHANNEL_ID}/${messageId}`;

        const logSheet = SpreadsheetApp.openById(LOGSHEET_ID).getSheets()[0];
        logSheet.appendRow([
            getAnswer("Ваше имя и фамилия", itemResponses),
            getAnswer("Ваш статик", itemResponses),
            getAnswer("Ваш ранг", itemResponses),
            finalBonus,
            discordMessageUrl,
            formResponse.getId()
        ]);

        updateHiddenField(formResponse, totalBonus);
    } catch (error) {
        sendErrorToDiscord(error);
    }
}



function extractNumber(value) {
    try {
        if (typeof value === 'number') return value;
        if (!value) return 0;
        const numbers = value.toString().match(/\d+/g);
        return numbers ? parseInt(numbers.join(''), 10) : 0;
    } catch (e) {
        return 0;
    }
}

function splitLongText(text) {
    const parts = [];
    let remaining = text;
    while (remaining.length > 0) {
        let chunk = remaining.substring(0, MAX_FIELD_LENGTH);
        const lastHttp = chunk.lastIndexOf('http');
        if (lastHttp > 0 && chunk.length === MAX_FIELD_LENGTH) {
            const lastSpace = chunk.lastIndexOf(' ', lastHttp);
            if (lastSpace > 0) chunk = chunk.substring(0, lastSpace);
        }
        parts.push(chunk);
        remaining = remaining.substring(chunk.length);
    }
    return parts;
}

function updateHiddenField(formResponse, totalBonus) {
    try {
        const form = FormApp.getActiveForm();
        const bonusItem = form.getItems().find(item =>
            item.getTitle().includes("Итоговая премия")
        );
        if (bonusItem) {
            formResponse.withItemResponse(
                bonusItem.asTextItem().createResponse(totalBonus.toString())
            ).submit();
        }
    } catch (err) {}
}

function getAnswer(title, responses) {
    const response = responses.find(r => r.getItem().getTitle() === title);
    return response ? response.getResponse() : "-";
}

function sendErrorToDiscord(error) {
    const errorPayload = {
        content: "\u{1F6A8} **Ошибка при обработке формы**",
        embeds: [{
            title: "Детали ошибки",
            description: "```" + error.toString() + "```",
            color: 16711680,
            fields: [{ name: "Stack trace", value: "```" + (error.stack || "Нет данных") + "```" }],
            timestamp: new Date().toISOString()
        }]
    };
    UrlFetchApp.fetch(POST_URL, {
        method: "post",
        payload: JSON.stringify(errorPayload),
        contentType: "application/json"
    });
}

// --- generateFullSummary и autoSendBonusSummary ---
function generateFullSummary() {
    const sheet = SpreadsheetApp.openById(LOGSHEET_ID).getSheets()[0];
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const nameIndex = headers.indexOf("Имя");
    const staticIndex = headers.indexOf("Статик");
    const rankIndex = headers.indexOf("Ранг");
    const bonusIndex = headers.indexOf("Бонус");
    const urlIndex = headers.indexOf("Ссылка на сообщение");
    const responseIdIndex = headers.indexOf("responseId");

    const sinceDate = new Date("2025-05-11T00:00:00Z");
    const form = FormApp.openById(FORM_ID);
    const allResponses = form.getResponses();
    const validResponses = allResponses.filter(r => r.getTimestamp() >= sinceDate);

    const idToMessageUrl = new Map(data.slice(1).map(row => [row[responseIdIndex], row[urlIndex]]));
    const idToBonus = new Map(data.slice(1).map(row => [row[responseIdIndex], row[bonusIndex]]));
    const idToName = new Map(data.slice(1).map(row => [row[responseIdIndex], row[nameIndex]]));
    const idToStatic = new Map(data.slice(1).map(row => [row[responseIdIndex], row[staticIndex]]));
    const idToRank = new Map(data.slice(1).map(row => [row[responseIdIndex], row[rankIndex]]));

    const processed = validResponses.map(resp => {
        const id = resp.getId();
        const url = idToMessageUrl.get(id);
        if (!url || !url.toString().includes("https://discord.com/channels/")) return null;
        return {
            name: idToName.get(id),
            static: idToStatic.get(id),
            rank: idToRank.get(id),
            bonus: idToBonus.get(id),
            messageUrl: url
        };
    }).filter(Boolean);

    if (processed.length > 0) {
        const textBlock = processed.map(entry =>
            `${entry.name}, ${entry.static}, ${entry.rank}, ${entry.bonus}`
        ).join("\n");

        const linkBlock = processed.map(entry => entry.messageUrl).join("\n");

        UrlFetchApp.fetch(SUMMARY_WEBHOOK_URL, {
            method: "post",
            contentType: "application/json",
            payload: JSON.stringify({ content: textBlock })
        });

        Utilities.sleep(1000);

        UrlFetchApp.fetch(SUMMARY_WEBHOOK_URL, {
            method: "post",
            contentType: "application/json",
            payload: JSON.stringify({ content: linkBlock })
        });
    }
}

function autoSendBonusSummary() {
    try {
        generateFullSummary();
    } catch (e) {
        Logger.log("Ошибка при автоотправке: " + e);
    }
}

function forceSendSummaryNow() {
    try {
        Logger.log("Принудительная отправка сводки...");
        generateFullSummary();
        Logger.log("Сводка отправлена вручную.");
    } catch (e) {
        Logger.log("Ошибка при ручной отправке сводки: " + e);
        sendErrorToDiscord(e);
    }
}
function generateSummaryForSpreadsheet() {
    const sheet = SpreadsheetApp.openById(LOGSHEET_ID).getSheets()[0];
    const dataRange = sheet.getDataRange();
    const data = dataRange.getValues();
    const headers = data[0];
    const nameIndex = headers.indexOf("Имя");
    const staticIndex = headers.indexOf("Статик");
    const rankIndex = headers.indexOf("Ранг");
    const bonusIndex = headers.indexOf("Бонус");
    const urlIndex = headers.indexOf("Ссылка на сообщение");

    const rows = data.slice(1).map(row => {
        const url = row[urlIndex];
        if (!url || typeof url !== "string" || !url.includes("https://discord.com/channels/")) return null;
        return [row[nameIndex], row[staticIndex], row[rankIndex], row[bonusIndex], url];
    }).filter(Boolean);

    if (rows.length === 0) {
        Logger.log("Нет валидных ссылок в логах.");
        return;
    }

    const csv = ["Имя,Статик,Ранг,Бонус,Ссылка"].concat(
        rows.map(row => {
            return `${row[0]},${row[1]},${row[2]},${row[3]},${row[4]}`;
        })
    ).join("\n");

    Logger.log("Скопируй в Google Таблицу:");
    Logger.log("\n" + csv);
}
