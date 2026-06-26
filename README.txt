================================================================================
  Zehnder ComfoConnect Pro — Homey app
  Verbind uw Zehnder WTW-installatie met Homey Pro
================================================================================

  Versie      : 1.1.0
  SDK         : Homey SDK 3
  Vereist     : Homey Pro firmware >= 12.2.0
  Protocol    : Modbus TCP (primair) + ComfoConnect binair protocol (optioneel)
  Compatibel  : Zehnder ComfoAir Q / ComfoAir Flex via ComfoConnect Pro
  Repository  : https://github.com/Barney1977/Comfoconnectpro


--------------------------------------------------------------------------------
  BESCHRIJVING
--------------------------------------------------------------------------------

  Deze app verbindt de Zehnder ComfoConnect Pro gateway (Art. Nr. 471 429 300)
  met Homey Pro. De ComfoConnect Pro is de Modbus/internet-schnittstelle voor
  Zehnder ComfoAir Q350, Q450 en Q600 WTW-ventilatieunits.

  De app gebruikt twee onafhankelijke verbindingen:

  1. Modbus TCP (poort 502) — altijd actief
     Stabiele verbinding voor bediening en sensoren.
     Meerdere clients kunnen gelijktijdig verbinden.

  2. ComfoConnect binair protocol (poort 56747) — optioneel
     Energiemeting en ventilatordata (W, kWh, m³/h, RPM).
     Maximaal één actieve sessie tegelijk. Herstelt automatisch
     als de ComfoControl-app of Zehnder Cloud de verbinding overneemt.


--------------------------------------------------------------------------------
  INSTALLATIE
--------------------------------------------------------------------------------

  Vereisten:
  - Zehnder ComfoConnect Pro aangesloten op uw LAN of WiFi
  - Modbus TCP ingeschakeld op het apparaat (via http://comfoconnectpro.local)
  - Statisch IP-adres aanbevolen voor de ComfoConnect Pro

  Stappen:
  1. Installeer de app via Homey App Store of:
        homey app install

  2. Voeg een apparaat toe in Homey:
        Apparaten → + → Zehnder ComfoConnect Pro

  3. Vul het IP-adres in van uw ComfoConnect Pro
     (standaard bereikbaar via http://comfoconnectpro.local)

  4. Laat Poort (502) en Unit ID (1) op standaard staan

  5. Optioneel: schakel energiemonitoring in via Apparaatinstellingen


--------------------------------------------------------------------------------
  BEDIENING VIA UI
--------------------------------------------------------------------------------

  Schakelaar  Afwezig      Ventilatie op stand 0 (afwezig) zetten
  Schakelaar  Boost        Partytimer activeren (standaard 1 uur)
  Schakelaar  Auto         Automatische ventilatieregeling aan/uit
  Picker      Snelheid     Ventilatiesnelheid: Afwezig / Laag / Midden / Hoog
  Picker      Temperatuur  Temperatuurprofiel: Normaal / Koel / Warm
  Slider      Setpoint     Toevoerlucht temperatuursetpoint (10–35°C)


--------------------------------------------------------------------------------
  SENSOREN
--------------------------------------------------------------------------------

  Via Modbus TCP (altijd beschikbaar):
  ┌─────────────────────────────────┬────────────────────────────────────────┐
  │ Sensor                          │ Bron                                   │
  ├─────────────────────────────────┼────────────────────────────────────────┤
  │ Binnentemperatuur               │ Afluchtsensor ETA (register 0x0008)    │
  │ Buitentemperatuur               │ Buitenluchtsensor ODA (register 0x000A)│
  │ Toevoertemperatuur              │ Toevoersensor SUP (register 0x000B)    │
  │ Afvoertemperatuur               │ Afluchtsensor ETA (register 0x0008)    │
  │ Binnenvochtigheid               │ Afluchtsensor ETA (register 0x000D)    │
  │ Buitenvochtigheid               │ Buitenluchtsensor ODA (register 0x000F)│
  │ Filterdagen resterend           │ Filterstatus (register 0x0019)         │
  │ Filtervervanging alarm          │ Discrete input 0x0003                  │
  │ Toestel alarm                   │ Discrete input 0x0000                  │
  │ Modbus verbindingsstatus        │ Input register 0x0000                  │
  └─────────────────────────────────┴────────────────────────────────────────┘

  Via energiemonitoring (optioneel, ComfoConnect protocol):
  ┌─────────────────────────────────┬────────────────────────────────────────┐
  │ Sensor                          │ PDO code                               │
  ├─────────────────────────────────┼────────────────────────────────────────┤
  │ Vermogen actueel (W)            │ 128                                    │
  │ Energie totaal (kWh)            │ 130  → Homey Energy                   │
  │ Energie dit jaar (kWh)          │ 129                                    │
  │ Voorverwarmer vermogen (W)      │ 146                                    │
  │ Luchtdebiet toevoer (m³/h)      │ 120                                    │
  │ Luchtdebiet afvoer (m³/h)       │ 119                                    │
  │ Toerental toevoer (RPM)         │ 122                                    │
  │ Toerental afvoer (RPM)          │ 121                                    │
  │ Ventilatorbelasting toevoer (%) │ 118                                    │
  │ Ventilatorbelasting afvoer (%)  │ 117                                    │
  │ Bypass stand (%)                │ 227                                    │
  │ Filterdagen resterend           │ 192                                    │
  │ Energiesessie status            │ intern                                 │
  └─────────────────────────────────┴────────────────────────────────────────┘


--------------------------------------------------------------------------------
  FLOWS
--------------------------------------------------------------------------------

  TRIGGERS (wanneer)
  ──────────────────
  • Filtervervanging vereist
    Vuurt bij stijgende flank van het filteralarm

  • Ventilatiesnelheid gewijzigd
    Token: preset (0=afwezig, 1=laag, 2=midden, 3=hoog)

  • Ventilatie op afwezig gezet
  • Ventilatie op laag gezet
  • Ventilatie op midden gezet
  • Ventilatie op hoog gezet
    Vier afzonderlijke triggers voor elke presetovergang

  • Toestel alarm geactiveerd
    Stijgende flank: er is een nieuwe fout gemeld

  • Toestel alarm opgeheven
    Dalende flank: fout is hersteld

  • Energiesessie onderbroken
    ComfoControl-app of Zehnder Cloud heeft de sessie overgenomen

  • Energiesessie hersteld
    Automatisch herstel na onderbreking

  CONDITIES (als)
  ───────────────
  • Afwezigheidsmodus is actief/inactief
  • Boost (partytimer) is actief/inactief
  • Automodus is actief/inactief
  • Filter moet/hoeft niet vervangen te worden
  • Energiesessie is actief/inactief
  • Ventilatiesnelheid is/is niet [keuze: 0/1/2/3]
  • Temperatuurprofiel is/is niet [keuze: normaal/koel/warm]
  • Toestel alarm is actief/inactief

  ACTIES (dan)
  ────────────
  • Ventilatiesnelheid instellen (0=afwezig / 1=laag / 2=midden / 3=hoog)
  • Afwezigheidsmodus instellen (aan/uit)
  • Boost activeren met instelbare duur (1–1440 minuten)
  • Boost stoppen
  • Temperatuurprofiel instellen (normaal / koel / warm)
  • Toevoerlucht setpoint instellen (10–35°C)
  • Temperatuurprofielmodus instellen (adaptief / vast / extern setpoint)
  • ComfoClime instellen (aan automatisch / uit)
  • Automodus instellen (auto / manueel)
  • Fouten ventilatieunit resetten


--------------------------------------------------------------------------------
  APPARAATINSTELLINGEN
--------------------------------------------------------------------------------

  IP-adres
    IP-adres van de ComfoConnect Pro op uw netwerk.
    Standaard bereikbaar via http://comfoconnectpro.local

  Modbus TCP-poort
    Standaard: 502. Alleen wijzigen bij aangepaste netwerkconfiguratie.

  Modbus Unit ID
    Standaard: 1. Niet wijzigen tenzij anders geconfigureerd.

  Poll interval (seconden)
    Hoe vaak Modbus-sensoren worden uitgelezen. Standaard: 30 seconden.
    Bij actieve energiesessie wordt dit automatisch verhoogd naar 60 seconden
    om TCP-conflicten te voorkomen.

  Energie- en ventilatiemonitoring inschakelen
    Schakelt de optionele verbinding via het ComfoConnect-protocol in.
    Vereist voor vermogen, kWh, m³/h, RPM en bypassdata.
    De verbinding herstelt automatisch bij onderbreking.

  Gateway UUID
    Wordt automatisch ingevuld bij eerste verbinding via UDP-discovery.
    Handmatig in te voeren als discovery mislukt.

  Basisvertraging herverbinding energie (seconden)
    Wachttijd na sessieverbreking vóór eerste herstelpoging.
    Standaard: 15 seconden. Verdubbelt per poging tot maximaal 5 minuten.


--------------------------------------------------------------------------------
  HOMEY ENERGY
--------------------------------------------------------------------------------

  Als energiemonitoring ingeschakeld is, verschijnt het apparaat automatisch
  in Homey Energy. De volgende standaard capabilities worden gebruikt:

  measure_power  →  actueel vermogen in Watt
  meter_power    →  cumulatieve energieteller in kWh

  De kWh-teller wordt altijd doorgegeven (geen drempelwaarde).
  Kleine fluctuaties in W, m³/h en RPM worden gefilterd om onnodige
  UI-updates te voorkomen (drempelwaarden: 2W, 5 m³/h, 50 RPM).


--------------------------------------------------------------------------------
  TECHNISCHE INFORMATIE
--------------------------------------------------------------------------------

  Modbus registerkaart (0-gebaseerd, conform Zehnder TS816 Stand 11/2024):

  Discrete Inputs (alleen lezen):
    0x0000  Foutprotocol (bool)
    0x0001  Standby (bool)
    0x0002  ComfoHood status (bool)
    0x0003  Filter tauschen alarm (bool)

  Input Registers (alleen lezen):
    0x0000  Verbindingsstatus (0=OK)
    0x0001–0x0005  Actieve fouten 1–5
    0x0006  Toevoerventilator status (mch)
    0x0007  Ruimtetemperatuur °C×10 (optionele externe sensor)
    0x0008  Afluchtsensor ETA °C×10
    0x0009  Fortluchtsensor EHA °C×10
    0x000A  Buitenluchtsensor ODA °C×10
    0x000B  Toevoersensor SUP °C×10
    0x000C  Ruimtevochtigheid % (optionele externe sensor)
    0x000D  Afluchtvochtigheid ETA %
    0x000E  Fortluchtvochtigheid EHA %
    0x000F  Buitenluchtvochtigheid ODA %
    0x0010  Toevoervochtigheid SUP %
    0x0019  Filterstatus (dagen)

  Holding Registers (lezen/schrijven):
    0x0000  Ventilatiesnelheid (0–3)
    0x0001  Temperatuurprofiel (0=normaal, 1=koel, 2=warm)
    0x0002  Temperatuurprofielmodus (0=adaptief, 1=vast, 2=extern)
    0x0003  Extern setpoint °C×10
    0x0004  Partytimer duur (seconden)

  Coils (lezen/schrijven):
    0x0000  Fouten resetten
    0x0001  Preset afwezig
    0x0002  Preset 1 (laag)
    0x0003  Preset 2 (midden)
    0x0004  Preset 3 (hoog)
    0x0005  AUTO-modus
    0x0006  Partytimer aan/uit
    0x0007  Afwezigheidsfunctie
    0x0008  ComfoClime


--------------------------------------------------------------------------------
  BEKENDE BEPERKINGEN
--------------------------------------------------------------------------------

  • De ComfoConnect Pro staat maximaal één gelijktijdige energiesessie toe
    (poort 56747). Bij gebruik van de ComfoControl-app of Zehnder Cloud
    wordt de energiesessie tijdelijk onderbroken. Herstel is automatisch.

  • Modbus TCP werkt onbeperkt parallel aan de energiesessie. Bediening
    en temperatuursensoren zijn altijd beschikbaar.

  • Energiemeting vereist dat de gateway UUID bekend is. Bij de eerste
    verbinding wordt deze automatisch ontdekt via UDP-broadcast. Als dat
    mislukt kan de UUID handmatig worden ingevoerd in de instellingen.

  • De ComfoConnect Pro heeft intern geen apart vermogensregister via
    Modbus. Vermogensmeting is uitsluitend beschikbaar via het
    ComfoConnect-protocol (energiemonitoring optie).


--------------------------------------------------------------------------------
  LICENTIE EN CREDITS
--------------------------------------------------------------------------------

  Ontwikkeld voor de Homey community.
  Gebaseerd op Zehnder Technische Specificatie 816 (Stand 11/2024).
  Modbus-implementatie geïnspireerd op Barney1977/Alfen-ProlineSingle.

  Afhankelijkheden:
  • jsmodbus    ^4.0.6   — Modbus TCP client
  • comfoairq  ^0.6.2   — ComfoConnect binair protocol

  Zehnder ComfoConnect Pro: Art. Nr. 471 429 300
  Fabrikant: Zehnder Group Schweiz AG, Moortalstrasse 3, 5722 Gränichen

================================================================================
