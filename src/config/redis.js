const Redis = require('ioredis');
require('dotenv').config();

// Khởi tạo Redis với cấu hình từ biến môi trường và các tùy chọn tối ưu
const redis = new Redis({
    host: process.env.REDIS_HOST || '127.0.0.1',        // Địa chỉ host của Redis
    port: process.env.REDIS_PORT || 6379,               // Cổng kết nối Redis
    password: process.env.REDIS_PASSWORD || null,       // Mật khẩu nếu có
    db: process.env.REDIS_DB || 0,                      // Chọn database Redis, mặc định là 0
    maxRetriesPerRequest: 5,                            // Số lần thử lại khi request thất bại
    connectTimeout: 10000,                              // Thời gian timeout khi kết nối, tính bằng ms
    lazyConnect: true,                                  // Chỉ kết nối khi thực sự cần
    retryStrategy(times) {                              // Cách xử lý khi kết nối bị gián đoạn
        const delay = Math.min(times * 50, 2000);
        return delay; // Tăng dần thời gian chờ
    },
});

// Xử lý sự kiện kết nối thành công
redis.on('connect', () => {
    console.log('Redis đã kết nối thành công!');
});

// Xử lý sự kiện khi kết nối bị đóng
redis.on('end', () => {
    console.log('Kết nối Redis đã đóng.');
});

// Xử lý sự kiện lỗi
redis.on('error', (err) => {
    console.error('Lỗi kết nối Redis:', err);
});

module.exports = redis;
