<?php
declare(strict_types=1);
require __DIR__ . '/db.php';

match ($_SERVER['REQUEST_METHOD']) {
    'GET' => send_json(200, db_load_all()),
    'PUT' => handle_save(fn($body) => db_save_data($body['maanden'] ?? null, $body['facturen'] ?? null)),
    default => send_json(405, ['error' => 'Methode niet toegestaan']),
};
