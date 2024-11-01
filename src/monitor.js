const { ethers } = require('ethers');
require('dotenv').config();
const mongoose = require('mongoose');
const Tracking = require('./models/Tracking');

// Các Provider cho từng mạng
const providers = {
    ethereum: new ethers.JsonRpcProvider(process.env.ETH_PROVIDER),
    optimism: new ethers.JsonRpcProvider(process.env.OP_PROVIDER),
    base: new ethers.JsonRpcProvider(process.env.BASE_PROVIDER),
    arbitrum: new ethers.JsonRpcProvider(process.env.ARB_PROVIDER),
    zksync: new ethers.JsonRpcProvider(process.env.ZK_PROVIDER),
    shape: new ethers.JsonRpcProvider(process.env.SHAPE_PROVIDER),
    scroll: new ethers.JsonRpcProvider(process.env.SCROLL_PROVIDER),
};

// Các URL của blockchain explorer
const explorerUrls = {
    ethereum: 'https://etherscan.io',
    optimism: 'https://optimistic.etherscan.io',
    base: 'https://basescan.org',
    arbitrum: 'https://arbiscan.io',
    zksync: 'https://zkscan.io',
    shape: 'https://shapescan.xyz',
    scroll: 'https://scrollscan.com',
};

// Set lưu trữ tất cả các ví đang theo dõi
const trackingWallets = new Set();
const userTrackingMap = new Map();

// Lưu block cuối cùng đã quét cho từng mạng
const lastBlockScanned = {};

// ERC-20 và ERC-721 Transfer event topics
const TRANSFER_EVENT_TOPIC = ethers.id("Transfer(address,address,uint256)");

// Tải các ví đang theo dõi từ MongoDB khi khởi động bot
async function loadTrackingWallets() {
    const records = await Tracking.find({});
    records.forEach(record => {
        const { chatId, wallet, name } = record;
        if (!userTrackingMap.has(chatId)) {
            userTrackingMap.set(chatId, new Map());
        }
        userTrackingMap.get(chatId).set(wallet, name);
        trackingWallets.add(wallet);
    });
    console.log("Đã tải dữ liệu theo dõi từ MongoDB");
    console.log("Số lượng các ví đang theo dõi:", trackingWallets.size);
    console.log("Số lượng người dùng:", userTrackingMap.size);
}

// Hàm mã hóa địa chỉ ví thành topic hợp lệ 32 byte
function toTopicAddress(address) {
    return '0x' + address.toLowerCase().replace('0x', '').padStart(64, '0');
}

// Hàm chuyển đổi topic thành địa chỉ hợp lệ
function topicToAddress(topic) {
    if (!topic || topic.length !== 66) return null; // 66 bao gồm '0x' và 64 ký tự hex
    return ethers.getAddress('0x' + topic.slice(26));
}

// Hàm kiểm tra xem một địa chỉ ví đã được theo dõi bởi người dùng hay chưa
function isWalletTracked(chatId, wallet) {
    const currentWallets = userTrackingMap.get(chatId);
    return currentWallets?.has(wallet) || false;
}

// Toggle trạng thái theo dõi ví cho từng người dùng
async function toggleWalletTracking(chatId, wallet, name = null) {
    const currentWallets = userTrackingMap.get(chatId) || new Map();
    const existingName = currentWallets.get(wallet);

    if (currentWallets.has(wallet)) {
        // Nếu địa chỉ đã được theo dõi, xóa theo dõi
        currentWallets.delete(wallet);
        if (currentWallets.size === 0) userTrackingMap.delete(chatId);
        trackingWallets.delete(wallet);

        // Xóa khỏi MongoDB
        await Tracking.deleteOne({ chatId, wallet });
        return { status: "removed", message: `🔕 Ngừng theo dõi ví \`${wallet}\` (${existingName})` };
    } else {
        // Nếu chưa được theo dõi, thêm vào
        const finalName = name || existingName || wallet.slice(0, 6); // Đặt tên là 6 ký tự đầu nếu không có `name`
        currentWallets.set(wallet, finalName);
        userTrackingMap.set(chatId, currentWallets);
        trackingWallets.add(wallet);

        // Lưu vào MongoDB
        await Tracking.updateOne(
            { chatId, wallet },
            { chatId, wallet, name: finalName },
            { upsert: true } // Thêm mới nếu chưa tồn tại
        );

        return { status: "added", message: `🔔 Đã thêm ví \`${wallet}\` với tên *${finalName}* vào danh sách theo dõi` };
    }
}

// Hàm xác định loại token và trả về thông tin liên quan
async function getTokenDetails(provider, contractAddress, data, log) {
    const erc20Abi = [
        "function decimals() view returns (uint8)",
        "function symbol() view returns (string)"
    ];
    const erc721Abi = ["function ownerOf(uint256 tokenId) view returns (address)"];

    try {
        const erc20Contract = new ethers.Contract(contractAddress, erc20Abi, provider);
        const [decimals, symbol] = await Promise.all([
            erc20Contract.decimals(),
            erc20Contract.symbol()
        ]);
        const value = ethers.formatUnits(data, decimals);
        return { type: 'ERC-20', value, symbol };

    } catch {
        const erc721Contract = new ethers.Contract(contractAddress, erc721Abi, provider);
        try {
            const tokenId = ethers.toBigInt(log.topics[3]);
            await erc721Contract.ownerOf(tokenId);
            return { type: 'ERC-721', tokenId: tokenId.toString(), contractAddress };
        } catch {
            const tokenId = ethers.toBigInt(log.topics[3]);
            const quantity = ethers.toBigInt(data);
            return { type: 'ERC-1155', tokenId: tokenId.toString(), contractAddress, quantity: quantity.toString() };
        }
    }
}

// Giám sát sự kiện Transfer trên các mạng
async function startMonitoring(bot) {
    await loadTrackingWallets(); // Tải thông tin theo dõi từ MongoDB
    console.log("Đang khởi động giám sát...");
    for (const [network, provider] of Object.entries(providers)) {
        lastBlockScanned[network] = await provider.getBlockNumber();
        console.log(`Đã kết nối đến mạng ${network} ở block ${lastBlockScanned[network]}...`);

        setInterval(async () => {
            if (trackingWallets.size === 0) return;

            try {
                const latestBlock = await provider.getBlockNumber();
                const batchSize = 100;
                let fromBlock = lastBlockScanned[network] + 1;

                while (fromBlock <= latestBlock) {
                    const toBlock = Math.min(fromBlock + batchSize - 1, latestBlock);
                    console.log(`Đang lấy logs từ block ${fromBlock} đến ${toBlock} trên mạng ${network}...`);

                    const logs = await provider.getLogs({
                        fromBlock,
                        toBlock,
                        topics: [TRANSFER_EVENT_TOPIC]
                    });

                    if (logs.length === 0) {
                        console.log(`Không tìm thấy sự kiện Transfer nào từ block ${fromBlock} đến ${toBlock}`);
                    } else {
                        console.log(`Tìm thấy ${logs.length} sự kiện Transfer từ block ${fromBlock} đến ${toBlock}`);
                    }

                    await Promise.all(logs.map(async (log) => {
                        try {
                            const from = topicToAddress(log.topics[1]);
                            const to = topicToAddress(log.topics[2]);
                            const contractAddress = log.address;

                            if (from && to && (trackingWallets.has(from) || trackingWallets.has(to))) {
                                const tokenDetails = await getTokenDetails(provider, contractAddress, log.data, log);
                                const txUrl = `${explorerUrls[network]}/tx/${log.transactionHash}`;

                                await Promise.all(
                                    Array.from(userTrackingMap.entries()).map(async ([chatId, wallets]) => {
                                        if (wallets.has(from) || wallets.has(to)) {
                                            let fromName = from;
                                            let toName = wallets.get(to);
                                            if (!walletName) {
                                                fromName = wallets.get(from);
                                                toName = to;
                                            };
                                            let message;

                                            if (tokenDetails.type === 'ERC-20') {
                                                message = `🔔 Giao dịch mới trên *${network}*\n- Từ: [${fromName}](${explorerUrls[network]}/address/${from})\n- Đến: [${toName}](${explorerUrls[network]}/address/${to})\n- Loại: *${tokenDetails.type}*\n- Số lượng: *${tokenDetails.value} ${tokenDetails.symbol}*\n- TxHash: [Click để xem chi tiết](${txUrl})`;
                                            } else if (tokenDetails.type === 'ERC-721') {
                                                message = `🔔 Giao dịch mới trên *${network}*\n- Từ: [${fromName}](${explorerUrls[network]}/address/${from})\n- Đến: [${toName}](${explorerUrls[network]}/address/${to})\n- Loại: *${tokenDetails.type}*\n- ID NFT: *${tokenDetails.tokenId}*\n- TxHash: [Click để xem chi tiết](${txUrl})`;
                                            } else if (tokenDetails.type === 'ERC-1155') {
                                                message = `🔔 Giao dịch mới trên *${network}*\n- Từ: [${fromName}](${explorerUrls[network]}/address/${from})\n- Đến: [${toName}](${explorerUrls[network]}/address/${to})\n- Loại: *${tokenDetails.type}*\n- ID NFT: *${tokenDetails.tokenId}*\n- Số lượng: *${tokenDetails.quantity}*\n- TxHash: [Click để xem chi tiết](${txUrl})`;
                                            }

                                            await bot.api.sendMessage(chatId, message, {
                                                parse_mode: 'Markdown', link_preview_options: {
                                                    is_disabled: true
                                                }
                                            });
                                        }
                                    })
                                );
                            }
                        } catch (error) {
                            console.error(`Lỗi khi xử lý log trên mạng ${network}:`, error);
                        }
                    }));

                    fromBlock += batchSize;
                }
                lastBlockScanned[network] = latestBlock;
            } catch (error) {
                console.error(`Không thể lấy logs từ mạng ${network}:`, error);
            }
        }, 10000);
    }
}

module.exports = { startMonitoring, toggleWalletTracking, isWalletTracked };
