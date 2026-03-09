#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/prod/setup-logrotate.sh
#
# Installe la configuration logrotate pour AlphaTradingDesk sur le Dell.
# À exécuter UNE SEULE FOIS après le premier déploiement, ou après un
# changement de la config de rotation.
#
# Prérequis : logrotate installé (inclus dans Ubuntu par défaut)
# Usage     : sudo bash ~/apps/setup-logrotate.sh
#
# Résultat  :
#   /etc/logrotate.d/atd          ← config logrotate installée
#   /srv/atd/logs/app/            ← répertoire créé si absent
#   rotation : quotidienne, 30 jours, compress, copytruncate
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

LOG_DIR="/srv/atd/logs/app"
LOGROTATE_CONF="/etc/logrotate.d/atd"

echo "📁 Creating log directory: ${LOG_DIR}"
mkdir -p "${LOG_DIR}"
# Le conteneur backend tourne en tant que root (ou uid 1000) — on donne les droits
chmod 755 "${LOG_DIR}"

echo "⚙️  Writing logrotate config: ${LOGROTATE_CONF}"
cat > "${LOGROTATE_CONF}" << 'EOF'
# AlphaTradingDesk — logrotate configuration
# Rotates backend.log quotidiennement, garde 30 jours compressés.
#
# copytruncate : tronque le fichier en place au lieu de le renommer
#   → le processus Python (RotatingFileHandler) continue d'écrire sans
#     avoir besoin d'être redémarré ou de recevoir un signal SIGHUP.
#
# Le RotatingFileHandler dans logging_config.py est un filet de sécurité
# (10 MB max) — logrotate est la rotation définitive (30 jours).

/srv/atd/logs/app/backend.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
    dateext
    dateformat -%Y%m%d
    create 0644 root root
}
EOF

echo "✅ Logrotate config installed."
echo ""
echo "── Test de la config ──────────────────────────────────────"
echo "   logrotate --debug /etc/logrotate.d/atd"
echo ""
echo "── Forcer une rotation maintenant ────────────────────────"
echo "   sudo logrotate -f /etc/logrotate.d/atd"
echo ""
echo "── Vérifier les logs après rotation ──────────────────────"
echo "   ls -lh /srv/atd/logs/app/"
echo "──────────────────────────────────────────────────────────"
