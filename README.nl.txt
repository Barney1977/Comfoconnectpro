Bedien uw Zehnder ComfoConnect Pro ventilatieunit volledig vanuit Homey. Verbind via uw lokale netwerk met Modbus TCP en optioneel het ComfoConnect-energieprotocol.

Monitor binnen- en buitentemperatuur, luchtvochtigheid, luchtdebiet, ventilatortoerental, filterstatus en energieverbruik. Schakel tussen ventilatiestanden, activeer de afwezigheidsmodus, start een boost tot 24 uur en stel het temperatuurprofiel automatisch of op een vast setpoint in. Met Homey Flows automatiseert u alles: boost bij de deurbel, lagere ventilatie voor het slapengaan of een melding wanneer het filter vervangen moet worden.

Vereisten:
- Zehnder ComfoConnect Pro aangesloten op uw LAN of WiFi
- Modbus TCP ingeschakeld op het apparaat (via http://comfoconnectpro.local)
- Statisch IP-adres aanbevolen

Installatie:
1. Installeer de app via de Homey App Store.
2. Voeg een apparaat toe: Apparaten, dan +, dan Zehnder ComfoConnect Pro.
3. Vul het IP-adres in van uw ComfoConnect Pro.
4. Laat Poort (502) en Unit ID (1) op standaard staan.
5. Optioneel: schakel energiemonitoring in via Apparaatinstellingen.

Apparaatinstellingen:

IP-adres: Adres van de ComfoConnect Pro op uw netwerk. Standaard bereikbaar via http://comfoconnectpro.local

Modbus TCP-poort: Standaard: 502. Alleen wijzigen bij aangepaste netwerkconfiguratie.

Modbus Unit ID: Standaard: 1. Niet wijzigen tenzij anders geconfigureerd.

Poll interval (seconden): Hoe vaak Modbus-sensoren worden uitgelezen. Standaard: 30 seconden. Wordt automatisch verhoogd naar 60 seconden bij een actieve energiesessie om TCP-conflicten te voorkomen.

Energie- en ventilatiemonitoring inschakelen: Schakelt de optionele ComfoConnect-protocolverbinding in. Vereist voor vermogen, kWh, m3/h, RPM en bypassdata. Herstelt automatisch bij onderbreking.

Gateway UUID: Wordt automatisch ingevuld bij eerste verbinding via UDP-discovery. Handmatig in te voeren als discovery mislukt.

Basisvertraging herverbinding energie (seconden): Wachttijd na sessieverbreking vóór eerste herstelpoging. Standaard: 15 seconden, verdubbelt per poging tot maximaal 5 minuten.

Homey Energy:

Als energiemonitoring ingeschakeld is, verschijnt het apparaat automatisch in Homey Energy via measure_power voor actueel vermogen in Watt en meter_power voor de cumulatieve energieteller in kWh. De kWh-teller wordt altijd doorgegeven zonder drempelwaarde. Kleine fluctuaties in W, m3/h en RPM worden gefilterd om onnodige UI-updates te voorkomen (drempelwaarden: 2W, 5 m3/h, 50 RPM).