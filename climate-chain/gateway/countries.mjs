// 193 UN member states plus the Holy See and the State of Palestine (195). Each row is the capital
// (or seat of government) used as that country's air-quality sample point: ISO 3166-1 alpha-2 |
// name | capital | latitude | longitude | region. A capital is a proxy for the country, never its average.
const ROWS = `
AF|Afghanistan|Kabul|34.53|69.17|Asia
AL|Albania|Tirana|41.33|19.82|Europe
DZ|Algeria|Algiers|36.75|3.06|Africa
AD|Andorra|Andorra la Vella|42.51|1.52|Europe
AO|Angola|Luanda|-8.84|13.23|Africa
AG|Antigua and Barbuda|Saint John's|17.12|-61.85|Americas
AR|Argentina|Buenos Aires|-34.60|-58.38|Americas
AM|Armenia|Yerevan|40.18|44.51|Asia
AU|Australia|Canberra|-35.28|149.13|Oceania
AT|Austria|Vienna|48.21|16.37|Europe
AZ|Azerbaijan|Baku|40.41|49.87|Asia
BS|Bahamas|Nassau|25.05|-77.35|Americas
BH|Bahrain|Manama|26.23|50.59|Asia
BD|Bangladesh|Dhaka|23.81|90.41|Asia
BB|Barbados|Bridgetown|13.10|-59.61|Americas
BY|Belarus|Minsk|53.90|27.57|Europe
BE|Belgium|Brussels|50.85|4.35|Europe
BZ|Belize|Belmopan|17.25|-88.77|Americas
BJ|Benin|Porto-Novo|6.50|2.63|Africa
BT|Bhutan|Thimphu|27.47|89.64|Asia
BO|Bolivia|La Paz|-16.50|-68.15|Americas
BA|Bosnia and Herzegovina|Sarajevo|43.86|18.41|Europe
BW|Botswana|Gaborone|-24.65|25.91|Africa
BR|Brazil|Brasilia|-15.79|-47.88|Americas
BN|Brunei|Bandar Seri Begawan|4.89|114.94|Asia
BG|Bulgaria|Sofia|42.70|23.32|Europe
BF|Burkina Faso|Ouagadougou|12.37|-1.52|Africa
BI|Burundi|Gitega|-3.43|29.93|Africa
CV|Cabo Verde|Praia|14.93|-23.51|Africa
KH|Cambodia|Phnom Penh|11.56|104.93|Asia
CM|Cameroon|Yaounde|3.85|11.50|Africa
CA|Canada|Ottawa|45.42|-75.70|Americas
CF|Central African Republic|Bangui|4.36|18.56|Africa
TD|Chad|N'Djamena|12.13|15.06|Africa
CL|Chile|Santiago|-33.45|-70.67|Americas
CN|China|Beijing|39.90|116.41|Asia
CO|Colombia|Bogota|4.71|-74.07|Americas
KM|Comoros|Moroni|-11.70|43.26|Africa
CG|Congo|Brazzaville|-4.27|15.28|Africa
CD|DR Congo|Kinshasa|-4.44|15.27|Africa
CR|Costa Rica|San Jose|9.93|-84.08|Americas
CI|Cote d'Ivoire|Yamoussoukro|6.83|-5.29|Africa
HR|Croatia|Zagreb|45.81|15.98|Europe
CU|Cuba|Havana|23.11|-82.37|Americas
CY|Cyprus|Nicosia|35.19|33.38|Europe
CZ|Czechia|Prague|50.08|14.44|Europe
DK|Denmark|Copenhagen|55.68|12.57|Europe
DJ|Djibouti|Djibouti|11.59|43.15|Africa
DM|Dominica|Roseau|15.30|-61.39|Americas
DO|Dominican Republic|Santo Domingo|18.49|-69.93|Americas
EC|Ecuador|Quito|-0.18|-78.47|Americas
EG|Egypt|Cairo|30.04|31.24|Africa
SV|El Salvador|San Salvador|13.69|-89.19|Americas
GQ|Equatorial Guinea|Malabo|3.75|8.78|Africa
ER|Eritrea|Asmara|15.32|38.93|Africa
EE|Estonia|Tallinn|59.44|24.75|Europe
SZ|Eswatini|Mbabane|-26.31|31.14|Africa
ET|Ethiopia|Addis Ababa|9.03|38.74|Africa
FJ|Fiji|Suva|-18.14|178.44|Oceania
FI|Finland|Helsinki|60.17|24.94|Europe
FR|France|Paris|48.86|2.35|Europe
GA|Gabon|Libreville|0.39|9.45|Africa
GM|Gambia|Banjul|13.45|-16.58|Africa
GE|Georgia|Tbilisi|41.72|44.79|Asia
DE|Germany|Berlin|52.52|13.40|Europe
GH|Ghana|Accra|5.60|-0.19|Africa
GR|Greece|Athens|37.98|23.73|Europe
GD|Grenada|St. George's|12.06|-61.75|Americas
GT|Guatemala|Guatemala City|14.63|-90.51|Americas
GN|Guinea|Conakry|9.64|-13.58|Africa
GW|Guinea-Bissau|Bissau|11.86|-15.60|Africa
GY|Guyana|Georgetown|6.80|-58.16|Americas
HT|Haiti|Port-au-Prince|18.54|-72.34|Americas
VA|Holy See|Vatican City|41.90|12.45|Europe
HN|Honduras|Tegucigalpa|14.07|-87.19|Americas
HU|Hungary|Budapest|47.50|19.04|Europe
IS|Iceland|Reykjavik|64.15|-21.94|Europe
IN|India|New Delhi|28.61|77.21|Asia
ID|Indonesia|Jakarta|-6.21|106.85|Asia
IR|Iran|Tehran|35.69|51.39|Asia
IQ|Iraq|Baghdad|33.31|44.36|Asia
IE|Ireland|Dublin|53.35|-6.26|Europe
IL|Israel|Jerusalem|31.77|35.21|Asia
IT|Italy|Rome|41.90|12.50|Europe
JM|Jamaica|Kingston|17.99|-76.79|Americas
JP|Japan|Tokyo|35.68|139.69|Asia
JO|Jordan|Amman|31.95|35.93|Asia
KZ|Kazakhstan|Astana|51.17|71.43|Asia
KE|Kenya|Nairobi|-1.29|36.82|Africa
KI|Kiribati|Tarawa|1.45|173.03|Oceania
KW|Kuwait|Kuwait City|29.38|47.99|Asia
KG|Kyrgyzstan|Bishkek|42.87|74.59|Asia
LA|Laos|Vientiane|17.97|102.63|Asia
LV|Latvia|Riga|56.95|24.11|Europe
LB|Lebanon|Beirut|33.89|35.50|Asia
LS|Lesotho|Maseru|-29.31|27.48|Africa
LR|Liberia|Monrovia|6.30|-10.80|Africa
LY|Libya|Tripoli|32.89|13.19|Africa
LI|Liechtenstein|Vaduz|47.14|9.52|Europe
LT|Lithuania|Vilnius|54.69|25.28|Europe
LU|Luxembourg|Luxembourg|49.61|6.13|Europe
MG|Madagascar|Antananarivo|-18.88|47.51|Africa
MW|Malawi|Lilongwe|-13.97|33.79|Africa
MY|Malaysia|Kuala Lumpur|3.14|101.69|Asia
MV|Maldives|Male|4.18|73.51|Asia
ML|Mali|Bamako|12.64|-8.00|Africa
MT|Malta|Valletta|35.90|14.51|Europe
MH|Marshall Islands|Majuro|7.09|171.38|Oceania
MR|Mauritania|Nouakchott|18.08|-15.98|Africa
MU|Mauritius|Port Louis|-20.16|57.50|Africa
MX|Mexico|Mexico City|19.43|-99.13|Americas
FM|Micronesia|Palikir|6.92|158.16|Oceania
MD|Moldova|Chisinau|47.01|28.86|Europe
MC|Monaco|Monaco|43.74|7.42|Europe
MN|Mongolia|Ulaanbaatar|47.89|106.91|Asia
ME|Montenegro|Podgorica|42.44|19.26|Europe
MA|Morocco|Rabat|34.02|-6.84|Africa
MZ|Mozambique|Maputo|-25.97|32.57|Africa
MM|Myanmar|Naypyidaw|19.76|96.08|Asia
NA|Namibia|Windhoek|-22.56|17.08|Africa
NR|Nauru|Yaren|-0.55|166.92|Oceania
NP|Nepal|Kathmandu|27.72|85.32|Asia
NL|Netherlands|Amsterdam|52.37|4.90|Europe
NZ|New Zealand|Wellington|-41.29|174.78|Oceania
NI|Nicaragua|Managua|12.13|-86.25|Americas
NE|Niger|Niamey|13.51|2.11|Africa
NG|Nigeria|Abuja|9.08|7.40|Africa
KP|North Korea|Pyongyang|39.04|125.76|Asia
MK|North Macedonia|Skopje|42.00|21.43|Europe
NO|Norway|Oslo|59.91|10.75|Europe
OM|Oman|Muscat|23.59|58.41|Asia
PK|Pakistan|Islamabad|33.68|73.05|Asia
PW|Palau|Ngerulmud|7.50|134.62|Oceania
PS|Palestine|Ramallah|31.90|35.20|Asia
PA|Panama|Panama City|8.98|-79.52|Americas
PG|Papua New Guinea|Port Moresby|-9.44|147.18|Oceania
PY|Paraguay|Asuncion|-25.26|-57.58|Americas
PE|Peru|Lima|-12.05|-77.04|Americas
PH|Philippines|Manila|14.60|120.98|Asia
PL|Poland|Warsaw|52.23|21.01|Europe
PT|Portugal|Lisbon|38.72|-9.14|Europe
QA|Qatar|Doha|25.29|51.53|Asia
RO|Romania|Bucharest|44.43|26.10|Europe
RU|Russia|Moscow|55.76|37.62|Europe
RW|Rwanda|Kigali|-1.95|30.06|Africa
KN|Saint Kitts and Nevis|Basseterre|17.30|-62.72|Americas
LC|Saint Lucia|Castries|14.01|-60.99|Americas
VC|Saint Vincent and the Grenadines|Kingstown|13.16|-61.22|Americas
WS|Samoa|Apia|-13.83|-171.76|Oceania
SM|San Marino|San Marino|43.94|12.45|Europe
ST|Sao Tome and Principe|Sao Tome|0.34|6.73|Africa
SA|Saudi Arabia|Riyadh|24.71|46.68|Asia
SN|Senegal|Dakar|14.72|-17.47|Africa
RS|Serbia|Belgrade|44.79|20.45|Europe
SC|Seychelles|Victoria|-4.62|55.45|Africa
SL|Sierra Leone|Freetown|8.48|-13.23|Africa
SG|Singapore|Singapore|1.35|103.82|Asia
SK|Slovakia|Bratislava|48.15|17.11|Europe
SI|Slovenia|Ljubljana|46.06|14.51|Europe
SB|Solomon Islands|Honiara|-9.43|159.95|Oceania
SO|Somalia|Mogadishu|2.05|45.32|Africa
ZA|South Africa|Pretoria|-25.75|28.19|Africa
KR|South Korea|Seoul|37.57|126.98|Asia
SS|South Sudan|Juba|4.85|31.58|Africa
ES|Spain|Madrid|40.42|-3.70|Europe
LK|Sri Lanka|Colombo|6.93|79.86|Asia
SD|Sudan|Khartoum|15.50|32.56|Africa
SR|Suriname|Paramaribo|5.85|-55.20|Americas
SE|Sweden|Stockholm|59.33|18.07|Europe
CH|Switzerland|Bern|46.95|7.45|Europe
SY|Syria|Damascus|33.51|36.28|Asia
TJ|Tajikistan|Dushanbe|38.56|68.77|Asia
TZ|Tanzania|Dodoma|-6.16|35.75|Africa
TH|Thailand|Bangkok|13.76|100.50|Asia
TL|Timor-Leste|Dili|-8.56|125.57|Asia
TG|Togo|Lome|6.13|1.22|Africa
TO|Tonga|Nuku'alofa|-21.14|-175.20|Oceania
TT|Trinidad and Tobago|Port of Spain|10.65|-61.51|Americas
TN|Tunisia|Tunis|36.81|10.18|Africa
TR|Turkiye|Ankara|39.93|32.86|Asia
TM|Turkmenistan|Ashgabat|37.96|58.33|Asia
TV|Tuvalu|Funafuti|-8.52|179.20|Oceania
UG|Uganda|Kampala|0.35|32.58|Africa
UA|Ukraine|Kyiv|50.45|30.52|Europe
AE|United Arab Emirates|Abu Dhabi|24.45|54.38|Asia
GB|United Kingdom|London|51.51|-0.13|Europe
US|United States|Washington, D.C.|38.91|-77.04|Americas
UY|Uruguay|Montevideo|-34.90|-56.16|Americas
UZ|Uzbekistan|Tashkent|41.30|69.24|Asia
VU|Vanuatu|Port Vila|-17.73|168.32|Oceania
VE|Venezuela|Caracas|10.49|-66.88|Americas
VN|Vietnam|Hanoi|21.03|105.85|Asia
YE|Yemen|Sanaa|15.37|44.19|Asia
ZM|Zambia|Lusaka|-15.39|28.32|Africa
ZW|Zimbabwe|Harare|-17.83|31.05|Africa
`;

export const COUNTRIES = Object.freeze(ROWS.trim().split('\n').map((line) => {
  const [iso2, name, capital, lat, lng, region] = line.split('|');
  return Object.freeze({ iso2, name, capital, lat: Number(lat), lng: Number(lng), region });
}));
