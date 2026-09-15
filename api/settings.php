<?php
declare(strict_types=1);
require __DIR__ . '/db.php';

match ($_SERVER['REQUEST_METHOD']) {
    'PUT' => handle_save(fn($body) => db_save_settings($body)),
    default => send_json(405, ['error' => 'Methode niet toegestaan']),
};
