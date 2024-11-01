# Sử dụng Node.js phiên bản LTS
FROM node:18-alpine

# Cài đặt các gói phụ thuộc
RUN apk add --no-cache bash

# Thư mục làm việc trong container
WORKDIR /app

# Sao chép file package.json và package-lock.json để cài đặt các gói
COPY package*.json ./

# Cài đặt các gói phụ thuộc
RUN npm install

# Sao chép toàn bộ mã nguồn vào container
COPY ./src .

# Lệnh để khởi động bot từ bot.js
CMD ["node", "bot.js"]
