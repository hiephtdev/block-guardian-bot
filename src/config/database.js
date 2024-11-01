const mongoose = require('mongoose');

async function connectToDatabase() {
    const options = {
        user: process.env.DB_USERNAME,            // Tên người dùng
        pass: process.env.DB_PASSWORD,            // Mật khẩu
        dbName: process.env.DB_NAME,              // Tên cơ sở dữ liệu
        authSource: process.env.DB_AUTH_SOURCE,   // Tên cơ sở dữ liệu xác thực (thường là 'admin' nếu không xác định rõ)
        useNewUrlParser: true,
        useUnifiedTopology: true,
    };

    const host = process.env.DB_HOST || 'localhost';  // Địa chỉ máy chủ
    const port = process.env.DB_PORT || 27017;        // Cổng MongoDB

    try {
        await mongoose.connect(`mongodb://${host}:${port}`, options);
        console.log("✅ Đã kết nối thành công với MongoDB");
    } catch (error) {
        console.error("❌ Lỗi kết nối MongoDB:", error);
        process.exit(1); // Dừng ứng dụng nếu kết nối thất bại
    }
}

module.exports = connectToDatabase;
