require('dotenv').config();
const { Bot } = require('grammy');
const { ethers } = require('ethers');
const connectToDatabase = require('./config/database');
const { startMonitoring, toggleWalletTracking, isWalletTracked } = require('./monitor');

// Khởi tạo bot
const bot = new Bot(process.env.BOT_TOKEN);

// Provider để kiểm tra tên ENS
const ensProvider = new ethers.JsonRpcProvider(process.env.ETH_PROVIDER);

// Hàm kiểm tra và lấy tên ENS hoặc tên mặc định
async function getNameOrDefault(address) {
    try {
        const ensName = await ensProvider.lookupAddress(address);
        return ensName || address.slice(0, 6); // Tên ENS hoặc 6 ký tự đầu của địa chỉ
    } catch {
        return address.slice(0, 6); // Nếu xảy ra lỗi, lấy 6 ký tự đầu của địa chỉ
    }
}

async function processWalletInput(chatId, input) {
    const entries = input.split('\n');
    const responses = [];

    for (let entry of entries) {
        const [address, name] = entry.split(',').map((item) => item.trim());

        // Kiểm tra địa chỉ hợp lệ
        if (!ethers.isAddress(address)) {
            responses.push(`⚠️ Địa chỉ không hợp lệ: ${address}`);
            continue;
        }

        // Kiểm tra trạng thái của địa chỉ trước khi lấy tên ENS
        if (isWalletTracked(chatId, address)) {
            // Địa chỉ đã có trong danh sách theo dõi, xóa khỏi theo dõi
            const result = await toggleWalletTracking(chatId, address);
            responses.push(result.message);
        } else {
            // Địa chỉ chưa được theo dõi, lấy tên ENS hoặc tên mặc định
            const walletName = name || await getNameOrDefault(address);
            const result = await toggleWalletTracking(chatId, address, walletName);
            responses.push(result.message);
        }
    }

    return responses.join('\n');
}

async function startBot() {
    await connectToDatabase(); // Kết nối MongoDB
    // Khởi động lệnh /start
    bot.command("start", (ctx) => ctx.reply("Chào bạn! Hãy gửi cho tôi địa chỉ ví cùng tên (nếu có) theo định dạng:\n\naddress1,name1\naddress2,name2\n\nNếu không có tên, bot sẽ kiểm tra tên ENS hoặc đặt mặc định là 6 ký tự đầu của địa chỉ."));

    // Xử lý tin nhắn từ người dùng
    bot.on("message:text", async (ctx) => {
        const input = ctx.message.text.trim();
        const response = await processWalletInput(ctx.chat.id, input);
        ctx.reply(response, {
            parse_mode: "Markdown", link_preview_options: {
                is_disabled: true
            }
        });
    });
    startMonitoring(bot); // Khởi động giám sát
    bot.start(); // Khởi động bot
}

// Khởi động giám sát và bot
startBot();
