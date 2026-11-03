import makeWASocket, {
    useMultiFileAuthState,
    DisconnectReason,
    Browsers,
    jidNormalizedUser,
    fetchLatestWaWebVersion
} from '@whiskeysockets/baileys'

import pino from 'pino'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

const SESSION_DIR = './session'
const SUFFIX = ' KILL BY X-COM'

const logger = pino({ level: 'silent' })

// Verhindert, dass .kill in derselben Gruppe doppelt gleichzeitig läuft
const killLocks = new Set()

function getText(message) {
    const m = message.message

    return (
        m?.conversation ||
        m?.extendedTextMessage?.text ||
        m?.imageMessage?.caption ||
        m?.videoMessage?.caption ||
        ''
    ).trim()
}

function normalize(jid) {
    if (!jid) return null

    try {
        return jidNormalizedUser(jid)
    } catch {
        return jid
    }
}

async function startBot() {
    const { state, saveCreds } =
        await useMultiFileAuthState(SESSION_DIR)

    const { version, isLatest } = await fetchLatestWaWebVersion()

    console.log(
        `[X-COM] WhatsApp-Web-Version: ${version.join('.')} | aktuell: ${isLatest}`
    )

    const sock = makeWASocket({
        version,
        auth: state,

        logger,

        browser: Browsers.ubuntu('Chrome'),

        printQRInTerminal: false,

        markOnlineOnConnect: false
    })

    sock.ev.on('creds.update', saveCreds)

    // ==========================================
    // PAIRING CODE
    // ==========================================

    if (!state.creds.registered) {
        const rl = readline.createInterface({
            input,
            output
        })

        let phone = await rl.question(
            '\nWhatsApp-Nummer mit Ländervorwahl eingeben\n' +
            'Beispiel: 491701234567\n\n> '
        )

        rl.close()

        phone = phone.replace(/\D/g, '')

        if (!phone) {
            console.log('Keine gültige Telefonnummer.')
            process.exit(1)
        }

        try {
            const code = await sock.requestPairingCode(phone)

            const formatted =
                code.match(/.{1,4}/g)?.join('-') || code

            console.log('\n================================')
            console.log('       X-COM PAIRING CODE')
            console.log('================================')
            console.log('')
            console.log(formatted)
            console.log('')
            console.log('================================\n')

            console.log(
                'WhatsApp öffnen:\n' +
                'Verknüpfte Geräte -> Gerät verknüpfen -> ' +
                'Mit Telefonnummer verknüpfen\n'
            )
        } catch (err) {
            console.error(
                'Pairing-Code konnte nicht erstellt werden:',
                err?.message || err
            )
        }
    }

    // ==========================================
    // CONNECTION
    // ==========================================

    sock.ev.on('connection.update', async update => {
        const {
            connection,
            lastDisconnect
        } = update

        if (connection === 'open') {
            console.log('\n[X-COM] WhatsApp verbunden.')
            console.log(
                '[X-COM] Bot-JID:',
                sock.user?.id || 'unbekannt'
            )
            console.log('[X-COM] .kill ist bereit.\n')
        }

        if (connection === 'close') {
            const statusCode =
                lastDisconnect?.error?.output?.statusCode

            if (statusCode === DisconnectReason.loggedOut) {
                console.log(
                    '[X-COM] WhatsApp wurde abgemeldet.'
                )

                console.log(
                    'Session löschen und neu verbinden:'
                )

                console.log(
                    'rm -rf ~/xcom-bot/session'
                )

                return
            }

            console.log(
                '[X-COM] Verbindung unterbrochen. Verbinde neu...'
            )

            setTimeout(() => {
                startBot().catch(console.error)
            }, 1500)
        }
    })

    // ==========================================
    // COMMANDS
    // ==========================================

    sock.ev.on(
        'messages.upsert',
        async ({ messages, type }) => {

            // Nur NEUE Nachrichten.
            // Dadurch kann ein alter .kill aus der Historie
            // niemals beim Botstart ausgelöst werden.
            if (type !== 'notify') return

            for (const message of messages) {
                try {
                    if (!message.message) continue

                    // Nur Befehle von der eigenen,
                    // verbundenen WhatsApp-Nummer.
                    if (!message.key.fromMe) continue

                    const groupJid =
                        message.key.remoteJid

                    // Nur Gruppen
                    if (
                        !groupJid ||
                        !groupJid.endsWith('@g.us')
                    ) {
                        continue
                    }

                    const text =
                        getText(message).toLowerCase()

                    if (text !== '.kill') continue

                    // Doppelausführung verhindern
                    if (killLocks.has(groupJid)) {
                        console.log(
                            `[X-COM] .kill läuft bereits für ${groupJid}`
                        )
                        continue
                    }

                    killLocks.add(groupJid)

                    try {
                        console.log(
                            `\n[X-COM] KILL gestartet: ${groupJid}`
                        )

                        // ----------------------------------
                        // Gruppeninformationen abrufen
                        // ----------------------------------

                        const metadata =
                            await sock.groupMetadata(groupJid)

                        console.log(
                            `[X-COM] Gruppe: ${metadata.subject}`
                        )

                        console.log(
                            `[X-COM] Teilnehmer: ${metadata.participants.length}`
                        )

                        // ----------------------------------
                        // Eigene Nummer/JID eindeutig finden
                        // ----------------------------------

                        const selfIdentifiers = [
                            message.key.participant,
                            message.key.participantPn,
                            sock.user?.id
                        ]
                            .filter(Boolean)
                            .map(normalize)

                        function isSelf(participant) {
                            const participantIdentifiers = [
                                participant.id,
                                participant.phoneNumber,
                                participant.lid,
                                participant.jid
                            ]
                                .filter(Boolean)
                                .map(normalize)

                            return participantIdentifiers.some(
                                id =>
                                    selfIdentifiers.includes(id)
                            )
                        }

                        const selfParticipant =
                            metadata.participants.find(
                                isSelf
                            )

                        // Extrem wichtig:
                        // Falls der Bot sich selbst nicht sicher
                        // erkennen kann, wird NICHTS entfernt.
                        if (!selfParticipant) {
                            throw new Error(
                                'Eigene Botnummer konnte in der Gruppe ' +
                                'nicht eindeutig erkannt werden. ' +
                                'KILL wurde aus Sicherheitsgründen abgebrochen.'
                            )
                        }

                        if (!selfParticipant.admin) {
                            throw new Error(
                                'Die verbundene Botnummer ist kein Gruppenadmin.'
                            )
                        }

                        console.log(
                            '[X-COM] Eigene Botnummer erkannt:',
                            selfParticipant.id
                        )

                        // ----------------------------------
                        // GRUPPENNAMEN ÄNDERN
                        // ----------------------------------

                        const oldName =
                            metadata.subject || ''

                        const newName =
                            oldName.endsWith(SUFFIX)
                                ? oldName
                                : oldName + SUFFIX

                        try {
                            await sock.groupUpdateSubject(
                                groupJid,
                                newName
                            )

                            console.log(
                                `[X-COM] Neuer Gruppenname: ${newName}`
                            )
                        } catch (err) {
                            console.error(
                                '[X-COM] Gruppenname konnte nicht geändert werden:',
                                err?.message || err
                            )
                        }

                        // ----------------------------------
                        // ALLE AUSSER BOT
                        // ----------------------------------

                        const targets =
                            metadata.participants
                                .filter(
                                    participant =>
                                        !isSelf(participant)
                                )
                                .map(
                                    participant =>
                                        participant.id
                                )

                        console.log(
                            `[X-COM] Zu entfernen: ${targets.length}`
                        )

                        if (targets.length === 0) {
                            console.log(
                                '[X-COM] Niemand außer dem Bot ist mehr in der Gruppe.'
                            )
                            continue
                        }

                        /*
                         * WICHTIG:
                         *
                         * KEINE Schleife.
                         * KEIN einzelnes Entfernen.
                         *
                         * Das komplette Array wird in EINEM
                         * groupParticipantsUpdate-Aufruf gesendet.
                         */

                        const result =
                            await sock.groupParticipantsUpdate(
                                groupJid,
                                targets,
                                'remove'
                            )

                        console.log(
                            '\n[X-COM] KILL abgeschlossen.'
                        )

                        console.log(
                            `[X-COM] ${targets.length} Teilnehmer wurden ` +
                            'in einem Batch-Request übergeben.'
                        )

                        console.dir(
                            result,
                            { depth: null }
                        )

                    } catch (err) {
                        console.error(
                            '\n[X-COM] KILL FEHLER:',
                            err?.message || err
                        )

                    } finally {
                        killLocks.delete(groupJid)
                    }

                } catch (err) {
                    console.error(
                        '[X-COM] Nachrichtenfehler:',
                        err?.message || err
                    )
                }
            }
        }
    )
}

startBot().catch(err => {
    console.error(
        '[X-COM] Schwerer Fehler:',
        err
    )
})
