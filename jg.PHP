<?php
// api/config.php
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit; }

$DB_HOST = 'localhost';
$DB_NAME = 'cassino';
$DB_USER = 'root';
$DB_PASS = '';

try {
  $pdo = new PDO("mysql:host=$DB_HOST;dbname=$DB_NAME;charset=utf8mb4", $DB_USER, $DB_PASS, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
  ]);
} catch (Throwable $e) {
  http_response_code(500);
  echo json_encode(['error' => 'DB connect failed', 'details' => $e->getMessage()]);
  exit;
}

function rand_secure(int $min, int $max): int {
  // PRNG criptográfico para evitar manipulação
  $range = $max - $min;
  if ($range <= 0) return $min;
  $bytes = random_bytes(4);
  $val = unpack('N', $bytes)[1] & 0x7fffffff;
  return $min + ($val % ($range + 1));
}

function json_input(): array {
  $raw = file_get_contents('php://input');
  $data = json_decode($raw, true);
  return is_array($data) ? $data : [];
}

function cents(int $reais): int { return $reais; } // já trabalhamos em centavos do lado do cliente

// api/login.php
require __DIR__.'/config.php';
$body = $_POST + json_input();
$username = trim($body['username'] ?? '');
if ($username === '') { http_response_code(400); echo json_encode(['error'=>'username_required']); exit; }

// tenta buscar
$stmt = $pdo->prepare('SELECT id, username, api_key, balance FROM users WHERE username = ? LIMIT 1');
$stmt->execute([$username]);
$user = $stmt->fetch();

if (!$user) {
  $apiKey = bin2hex(random_bytes(32));
  $stmt = $pdo->prepare('INSERT INTO users (username, api_key) VALUES (?, ?)');
  $stmt->execute([$username, $apiKey]);
  $id = (int)$pdo->lastInsertId();
  $user = ['id'=>$id, 'username'=>$username, 'api_key'=>$apiKey, 'balance'=>100];
}

echo json_encode(['ok'=>true, 'user'=>$user]);

// api/state.php
require __DIR__.'/config.php';
$user_id = (int)($_GET['user_id'] ?? ($_POST['user_id'] ?? 0));
$api_key = $_GET['api_key'] ?? ($_POST['api_key'] ?? '');

$stmt = $pdo->prepare('SELECT id, username, balance FROM users WHERE id=? AND api_key=? LIMIT 1');
$stmt->execute([$user_id, $api_key]);
$user = $stmt->fetch();
if(!$user){ http_response_code(401); echo json_encode(['error'=>'auth']); exit; }

// últimos 20 giros
$stmt = $pdo->prepare('SELECT bet, line, multiplier, win, balance_after, created_at FROM spins WHERE user_id=? ORDER BY id DESC LIMIT 20');
$stmt->execute([$user_id]);
$history = $stmt->fetchAll();

echo json_encode(['ok'=>true, 'user'=>$user, 'history'=>$history]);

// api/deposit.php
require __DIR__.'/config.php';
$body = $_POST + json_input();
$user_id = (int)($body['user_id'] ?? 0);
$api_key = $body['api_key'] ?? '';
$amount = (int)($body['amount'] ?? 0); // centavos
if($amount<=0){ http_response_code(400); echo json_encode(['error'=>'invalid_amount']); exit; }

$pdo->beginTransaction();
$stmt = $pdo->prepare('SELECT id, balance FROM users WHERE id=? AND api_key=? FOR UPDATE');
$stmt->execute([$user_id, $api_key]);
$user = $stmt->fetch();
if(!$user){ $pdo->rollBack(); http_response_code(401); echo json_encode(['error'=>'auth']); exit; }

$new = $user['balance'] + $amount;
$pdo->prepare('UPDATE users SET balance=? WHERE id=?')->execute([$new, $user_id]);
$pdo->prepare('INSERT INTO transactions(user_id,type,amount) VALUES(?,?,?)')->execute([$user_id,'deposit',$amount]);
$pdo->commit();

echo json_encode(['ok'=>true,'balance'=>$new]);
// api/withdraw.php
require __DIR__.'/config.php';
$body = $_POST + json_input();
$user_id = (int)($body['user_id'] ?? 0);
$api_key = $body['api_key'] ?? '';
$amount = (int)($body['amount'] ?? 0); // centavos
if($amount<=0){ http_response_code(400); echo json_encode(['error'=>'invalid_amount']); exit; }

$pdo->beginTransaction();
$stmt = $pdo->prepare('SELECT id, balance FROM users WHERE id=? AND api_key=? FOR UPDATE');
$stmt->execute([$user_id, $api_key]);
$user = $stmt->fetch();
if(!$user){ $pdo->rollBack(); http_response_code(401); echo json_encode(['error'=>'auth']); exit; }
if($user['balance'] < $amount){ $pdo->rollBack(); http_response_code(400); echo json_encode(['error','insufficient_funds']); exit; }

$new = $user['balance'] - $amount;
$pdo->prepare('UPDATE users SET balance=? WHERE id=?')->execute([$new, $user_id]);
$pdo->prepare('INSERT INTO transactions(user_id,type,amount) VALUES(?,?,?)')->execute([$user_id,'withdraw',$amount]);
$pdo->commit();

echo json_encode(['ok'=>true,'balance'=>$new]);
// api/spin.php
require __DIR__.'/config.php';
$body = $_POST + json_input();
$user_id = (int)($body['user_id'] ?? 0);
$api_key = $body['api_key'] ?? '';
$bet = (int)($body['bet'] ?? 0); // centavos
if($bet<=0){ http_response_code(400); echo json_encode(['error'=>'invalid_bet']); exit; }

$pdo->beginTransaction();
$stmt = $pdo->prepare('SELECT id, balance FROM users WHERE id=? AND api_key=? FOR UPDATE');
$stmt->execute([$user_id, $api_key]);
$user = $stmt->fetch();
if(!$user){ $pdo->rollBack(); http_response_code(401); echo json_encode(['error'=>'auth']); exit; }
if($user['balance'] < $bet){ $pdo->rollBack(); http_response_code(400); echo json_encode(['error','insufficient_funds']); exit; }

$SYMBOLS = ['🍒','🔔','🍀','⭐','💎'];
$PAY = [ '💎💎💎'=>25, '⭐⭐⭐'=>10, '🍀🍀🍀'=>7, '🍒🍒🍒'=>5, '🔔🔔🔔'=>3 ];

$targets = [ rand_secure(0,4), rand_secure(0,4), rand_secure(0,4) ];
$line = $SYMBOLS[$targets[0]].$SYMBOLS[$targets[1]].$SYMBOLS[$targets[2]];
$mult = $PAY[$line] ?? 0;
if($mult===0){
  // qualquer 2 iguais
  $set = count(array_unique([$SYMBOLS[$targets[0]],$SYMBOLS[$targets[1]],$SYMBOLS[$targets[2]]]));
  if($set===2) $mult = 1;
}
$win = $bet * $mult;

$newBalance = $user['balance'] - $bet + $win;
$pdo->prepare('UPDATE users SET balance=? WHERE id=?')->execute([$newBalance, $user_id]);
$pdo->prepare('INSERT INTO spins(user_id, bet, line, multiplier, win, balance_after) VALUES(?,?,?,?,?,?)')
    ->execute([$user_id, $bet, $line, $mult, $win, $newBalance]);
$pdo->commit();

echo json_encode([
  'ok'=>true,
  'line'=>$line,
  'symbols'=>[$SYMBOLS[$targets[0]],$SYMBOLS[$targets[1]],$SYMBOLS[$targets[2]]],
  'multiplier'=>$mult,
  'win'=>$win,
  'balance'=>$newBalance
]);

