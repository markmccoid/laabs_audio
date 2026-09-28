#!/usr/bin/env python3
"""Compile the production Swift SQLite adapter and kill real writer processes after receipts."""
import pathlib
import subprocess
import tempfile
root = pathlib.Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='native-listening-ledger-') as temp:
    binary = pathlib.Path(temp) / 'ledger-tests'
    subprocess.run(['xcrun', 'swiftc', '-module-cache-path', str(pathlib.Path(temp) / 'module-cache'), str(root / 'modules/react-native-audio-pro/ios/ListeningPositionLedger.swift'), str(root / 'modules/react-native-audio-pro/ios/Tests/ListeningPositionLedgerTests.swift'), '-o', str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
    database = str(pathlib.Path(temp) / 'positions.sqlite')
    for mode, expected in [('write-kill', 'COMMITTED:'), ('before-confirmation', 'PENDING'), ('before-commit', 'UNCOMMITTED')]:
        writer = subprocess.Popen([str(binary), mode, database], stdout=subprocess.PIPE, text=True)
        try:
            receipt = writer.stdout.readline().strip()
            assert receipt.startswith(expected), receipt
        finally:
            writer.kill()
            writer.wait()
        subprocess.run([str(binary), 'verify', database], check=True)
    subprocess.run([str(binary), 'verify', database], check=True)
print('Native listening-position persistence tests passed')
