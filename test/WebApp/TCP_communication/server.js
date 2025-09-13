// server.js
const WebSocket = require('ws');
const net = require('net');
const express = require('express');
const path = require('path');

const app = express();
const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });

// 정적 파일 제공
app.use(express.static(__dirname));

// 메인 페이지
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

console.log('🚀 ESP32 TCP 프록시 서버 시작...');

// WebSocket 연결 처리
wss.on('connection', (ws) => {
    console.log('📱 웹 클라이언트 연결됨');
    let tcpClient = null;
    let reconnectTimer = null;
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            switch(data.type) {
                case 'connect':
                    connectToESP32(data.ip, data.port);
                    break;
                    
                case 'send':
                    if (tcpClient && tcpClient.readyState === 'open') {
                        console.log('📤 ESP32로 전송:', data.message);
                        tcpClient.write(data.message + '\r'); // ESP32는 \r을 기대함
                        
                        // 전송 확인 응답
                        ws.send(JSON.stringify({
                            type: 'sent',
                            message: data.message,
                            timestamp: new Date().toISOString()
                        }));
                    } else {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'ESP32에 연결되어 있지 않습니다.'
                        }));
                    }
                    break;
                    
                case 'disconnect':
                    disconnectFromESP32();
                    break;
                    
                case 'ping':
                    // 연결 상태 확인
                    ws.send(JSON.stringify({
                        type: 'pong',
                        connected: tcpClient && tcpClient.readyState === 'open'
                    }));
                    break;
            }
        } catch (error) {
            console.error('❌ 메시지 파싱 오류:', error);
            ws.send(JSON.stringify({
                type: 'error',
                message: '잘못된 메시지 형식입니다.'
            }));
        }
    });
    
    function connectToESP32(ip, port) {
        console.log(`🔌 ESP32 연결 시도: ${ip}:${port}`);
        
        // 기존 연결이 있으면 종료
        disconnectFromESP32();
        
        ws.send(JSON.stringify({
            type: 'connecting',
            message: `${ip}:${port}로 연결 중...`
        }));
        
        tcpClient = new net.Socket();
        tcpClient.setTimeout(10000); // 10초 타임아웃
        
        // ESP32 연결 성공
        tcpClient.connect(port, ip, () => {
            console.log('✅ ESP32 연결 성공!');
            ws.send(JSON.stringify({
                type: 'connected',
                message: `${ip}:${port}에 연결되었습니다.`,
                ip: ip,
                port: port
            }));
        });
        
        // ESP32에서 데이터 수신
        tcpClient.on('data', (data) => {
            const message = data.toString().trim();
            console.log('📥 ESP32에서 수신:', message);
            
            ws.send(JSON.stringify({
                type: 'received',
                message: message,
                timestamp: new Date().toISOString()
            }));
        });
        
        // 연결 종료
        tcpClient.on('close', () => {
            console.log('🔌 ESP32 연결 종료됨');
            ws.send(JSON.stringify({
                type: 'disconnected',
                message: 'ESP32 연결이 종료되었습니다.'
            }));
            tcpClient = null;
        });
        
        // 연결 오류
        tcpClient.on('error', (error) => {
            console.error('❌ ESP32 연결 오류:', error.message);
            let errorMessage = '연결 실패: ';
            
            switch(error.code) {
                case 'ECONNREFUSED':
                    errorMessage += 'ESP32가 해당 포트에서 수신하지 않습니다.';
                    break;
                case 'EHOSTUNREACH':
                    errorMessage += 'ESP32에 접근할 수 없습니다. IP 주소를 확인하세요.';
                    break;
                case 'ETIMEDOUT':
                    errorMessage += '연결 시간이 초과되었습니다.';
                    break;
                default:
                    errorMessage += error.message;
            }
            
            ws.send(JSON.stringify({
                type: 'error',
                message: errorMessage
            }));
            
            tcpClient = null;
        });
        
        // 타임아웃
        tcpClient.on('timeout', () => {
            console.log('⏰ ESP32 연결 타임아웃');
            tcpClient.destroy();
            ws.send(JSON.stringify({
                type: 'error',
                message: '연결 시간이 초과되었습니다.'
            }));
        });
    }
    
    function disconnectFromESP32() {
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        
        if (tcpClient) {
            tcpClient.destroy();
            tcpClient = null;
        }
    }
    
    ws.on('close', () => {
        console.log('📱 웹 클라이언트 연결 해제됨');
        disconnectFromESP32();
    });
    
    ws.on('error', (error) => {
        console.error('❌ WebSocket 오류:', error);
    });
});

// 웹서버 시작
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🌐 ESP32 TCP 테스터가 포트 ${PORT}에서 실행 중입니다.`);
    console.log(`📱 브라우저에서 http://localhost:${PORT} 으로 접속하세요.`);
    console.log('');
    console.log('📋 사용법:');
    console.log('1. ESP32 코드를 업로드하고 시리얼 모니터에서 IP 주소 확인');
    console.log('2. 웹앱에서 ESP32 IP와 포트(10000) 입력');
    console.log('3. 연결 버튼 클릭');
    console.log('4. 메시지 전송 테스트');
    console.log('');
    console.log('💡 ESP32 IP 찾는 법:');
    console.log('   - 시리얼 모니터에서 "IP Address:" 확인');
    console.log('   - 보통 192.168.x.x 형태');
});

// 우아한 종료 처리
process.on('SIGINT', () => {
    console.log('\n🛑 서버를 종료합니다...');
    server.close(() => {
        console.log('✅ 서버가 종료되었습니다.');
        process.exit(0);
    });
});

// 에러 처리
process.on('uncaughtException', (error) => {
    console.error('💥 처리되지 않은 예외:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 처리되지 않은 Promise 거부:', reason);
    process.exit(1);
});