# 🛠️ Phase 3.1 — External Access via Tailscale VPN

**Date:** 20 mars 2026
**Version:** 1.0
**Status:** ⏳ À implémenter

> Accès sécurisé à l'app depuis l'extérieur du réseau local (4G/5G, autre réseau).
> Aucune migration DB, aucun nouveau service Docker.
> Référence détaillée (commandes + valeurs sensibles) : `custom/tailscale-setup.md`

---

## 🎯 Objectif

| Accès | URL | Disponibilité |
|-------|-----|---------------|
| LAN (actuel) | `https://alphatradingdesk.local` | Réseau local uniquement |
| Tailscale (nouveau) | `https://alphatradingdesk` | N'importe où (Tailscale actif) |

---

## 🗺️ Roadmap Phase 3.1

| Step | Quoi | Statut |
|------|------|--------|
| **P3.1-1** | Installer Tailscale sur le serveur (Dell) | ⏳ |
| **P3.1-2** | Installer Tailscale sur les clients (Mac + iPhone) | ⏳ |
| **P3.1-3** | Configurer MagicDNS + hostname dans l'admin Tailscale | ⏳ |
| **P3.1-4** | Régénérer le certificat SSL avec les SANs Tailscale | ⏳ |
| **P3.1-5** | Mettre à jour `server_name` dans nginx | ⏳ |
| **P3.1-6** | Re-trust du certificat sur tous les devices | ⏳ |
| **P3.1-7** | Test depuis l'extérieur (4G / hotspot) | ⏳ |

---

## Pourquoi Tailscale (et pas autre chose)

| Option | Ports ouverts | Cert de confiance | Complexité | Recommandé |
|--------|:------------:|:-----------------:|:----------:|:----------:|
| **Tailscale** | ❌ zéro | ✅ auto (MagicDNS) | Faible | ✅ |
| Cloudflare Tunnel | ❌ zéro | ✅ (domaine requis) | Moyenne | — |
| Port forwarding | ⚠️ oui | ⚠️ manuel | Faible | ❌ |

**Tailscale** = VPN mesh chiffré E2E — chaque device a une IP stable `100.x.x.x`.
Aucun port ouvert sur le routeur, fonctionne depuis 4G/5G/WiFi étranger.

---

## Step P3.1-1 — Installer Tailscale sur le Dell

```bash
# Ubuntu
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --hostname=alphatradingdesk
```

> Le flag `--hostname` est important : c'est lui qui détermine le nom MagicDNS.
> MagicDNS rendra le Dell accessible via `alphatradingdesk` sur tous les devices Tailscale.

---

## Step P3.1-2 — Installer Tailscale sur les clients

**macOS :**
```bash
brew install tailscale
# ou : App Store → Tailscale
sudo tailscale up
```

**iPhone :**
App Store → Tailscale → se connecter avec le même compte.

> Tous les devices doivent être connectés au **même compte Tailscale** pour se voir.

---

## Step P3.1-3 — Activer MagicDNS dans l'admin Tailscale

1. Aller sur [https://login.tailscale.com/admin/dns](https://login.tailscale.com/admin/dns)
2. Activer **MagicDNS** (si pas déjà actif)
3. Vérifier que le hostname du Dell apparaît bien comme `alphatradingdesk`

Résultat : depuis n'importe quel device Tailscale, le Dell est joignable via :
- `alphatradingdesk` (short hostname MagicDNS)
- `alphatradingdesk.<tailnet>.ts.net` (FQDN)

---

## Step P3.1-4 — Régénérer le certificat SSL avec les SANs Tailscale

Le certificat actuel a en SAN :
```
DNS:alphatradingdesk.local
IP:192.168.1.100        ← IP LAN
```

Il faut **ajouter** le hostname Tailscale et l'IP Tailscale :
```
DNS:alphatradingdesk.local
DNS:alphatradingdesk           ← MagicDNS court
IP:192.168.1.100               ← IP LAN
IP:100.x.x.x                   ← IP Tailscale du Dell
```

**Commandes (à adapter — voir `custom/tailscale-setup.md` pour les valeurs réelles) :**

```bash
# Sur le Dell — régénérer avec les nouveaux SANs
ssh <user>@<host> "rm /srv/atd/certs/atd.{crt,key}"

# Puis régénérer en ajoutant les SANs Tailscale à la commande openssl :
# -addext "subjectAltName=DNS:alphatradingdesk.local,DNS:alphatradingdesk,IP:<LAN_IP>,IP:<TAILSCALE_IP>"
# → voir ~/apps/setup-ssl.sh — modifier LAN_IP + ajouter les lignes DNS/IP Tailscale

# Redémarrer le container frontend pour charger le nouveau cert
ssh <user>@<host> "docker compose -f ~/apps/docker-compose.prod.yml up -d frontend"
```

> ⚠️ Après régénération du cert → re-trust sur **tous les devices** (étape P3.1-6).

---

## Step P3.1-5 — Mettre à jour server_name dans Nginx

Le fichier `frontend/nginx.conf` (monté dans le container) doit accepter le nouveau hostname.

```nginx
# Avant
server {
    listen 443 ssl;
    # pas de server_name explicite → accepte tout
    ...
}

# Après — optionnel mais propre
server {
    listen 443 ssl;
    server_name alphatradingdesk.local alphatradingdesk;
    ...
}
```

> Si `server_name` n'est pas défini, Nginx accepte déjà toutes les requêtes → pas bloquant.
> Le changement est surtout utile si tu veux des logs clairs ou des vhosts séparés plus tard.

---

## Step P3.1-6 — Re-trust du certificat sur tous les devices

### macOS (Keychain)
```bash
# Récupérer le nouveau cert depuis le Dell
scp <user>@alphatradingdesk.local:/srv/atd/certs/atd.crt ~/Downloads/atd.crt

# Révoquer l'ancien (optionnel — le nouveau le remplace)
# Faire confiance au nouveau
sudo security add-trusted-cert -d -r trustRoot \
     -k /Library/Keychains/System.keychain ~/Downloads/atd.crt
```

### iPhone (iOS)
1. Envoyer `atd.crt` sur le téléphone (AirDrop, email, etc.)
2. Ouvrir → "Autoriser" → Réglages → Général → VPN et gestion de l'appareil → installer le profil
3. Réglages → Général → Informations → Certificats de confiance → activer le certificat ATD

---

## Step P3.1-7 — Test depuis l'extérieur

```bash
# Depuis le Mac avec Tailscale actif + hors LAN (4G / hotspot)
curl -k https://alphatradingdesk/api/health
# → {"status": "ok"}

# Avec le cert de confiance installé (sans -k)
curl https://alphatradingdesk/api/health
# → {"status": "ok"}

# Depuis le browser
# → https://alphatradingdesk
```

---

## 📋 Checklist deploy

- [ ] Tailscale installé sur le Dell
- [ ] Tailscale installé sur Mac + connecté
- [ ] Tailscale installé sur iPhone + connecté
- [ ] MagicDNS activé — hostname `alphatradingdesk` visible
- [ ] Tailscale IP du Dell notée dans `custom/tailscale-setup.md`
- [ ] Cert SSL régénéré avec SANs Tailscale
- [ ] Container frontend redémarré
- [ ] Cert re-trusted sur macOS Keychain
- [ ] Cert installé + trusté sur iPhone
- [ ] Test `https://alphatradingdesk` depuis 4G → ✅

---

## 🔐 Sécurité

- Tailscale chiffre toutes les connexions E2E (WireGuard sous le capot)
- Zéro port ouvert sur le routeur — attaque réseau impossible depuis un device non autorisé
- Les devices doivent être approuvés dans l'admin Tailscale
- Désactiver un accès : retirer le device dans l'admin Tailscale → accès coupé immédiatement
- Le cert SSL reste auto-signé — il faut faire confiance explicitement sur chaque device

---

*Valeurs spécifiques (IPs, tailnet name, commandes exactes) → `custom/tailscale-setup.md`*
