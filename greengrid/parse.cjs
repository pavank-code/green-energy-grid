const fs = require('fs');
const html = fs.readFileSync('99acres_dump.html', 'utf8');

const targetStr = 'window.__initialData__=';
const startIdx = html.indexOf(targetStr);
if (startIdx !== -1) {
    let jsonStart = startIdx + targetStr.length;
    let braces = 0;
    let i = jsonStart;
    let jsonStr = '';
    while (i < html.length) {
        const char = html[i];
        if (char === '{') {
            braces++;
        } else if (char === '}') {
            braces--;
        }
        jsonStr += char;
        if (braces === 0 && jsonStr.length > 10) {
            break;
        }
        i++;
    }

    try {
        const state = JSON.parse(jsonStr);

        let props = state?.srp?.pageData?.properties || state?.srp?.results?.properties;
        if (!props) {
            // check state
            if (state?.srp?.propertiesList) {
                props = state.srp.propertiesList;
            }
        }
        if (props && props.length > 0) {
            console.log('Found', props.length, 'properties!');
            const p = props[0];
            console.dir({
                title: p.TITLE,
                propertyType: p.PROPERTY_TYPE,
                agentDetails: p.PD_USER?.companyName || p.PD_USER?.name,
                image: p.PHOTOS?.[0]?.url || p.IMAGE_URL,
                yearsBuilt: p.AGE,
                propertyAddress: p.LOCATION?.CITY_NAME,
                price: p.PRICE?.displayValue,
                area: p.AREA?.displayValue
            });
        } else {
            console.log('Keys in state:', Object.keys(state));
            console.log('Keys in state.srp:', Object.keys(state.srp || {}));
        }

    } catch (e) {
        console.error('Parse error:', e);
    }
}
