const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const navigatorPath = path.join(__dirname, '../screens/staff/StaffEventsNavigator.js');
const navigatorSource = fs.readFileSync(navigatorPath, 'utf8');

test('each native Staff route renders the shared background inside its screen', () => {
  assert.match(navigatorSource, /import \{ AuthBackground \} from '\.\.\/\.\.\/components\/ui\/AuthBackground';/);
  const eventsScreen = navigatorSource.split('function StaffEventsScreen(')[1].split('function StaffEventHomeScreen(')[0];
  const homeScreen = navigatorSource.split('function StaffEventHomeScreen(')[1].split('function StaffEventDashboard(')[0];
  for (const [screen, source, testID] of [
    ['StaffEventsScreen', eventsScreen, 'staff-events-background'],
    ['StaffEventHomeScreen', homeScreen, 'staff-event-home-background'],
  ]) {
    assert.match(source, new RegExp(`<AuthBackground testID="${testID}" variant="login">`), screen);
    assert.match(source, /<ScrollView contentContainerStyle=\{styles\.content\}>/, screen);
    assert.match(source, /<\/AuthBackground>/, screen);
    assert.doesNotMatch(source, /<SafeAreaView|backgroundColor:\s*['"](?:white|#fff(?:fff)?)['"]/, screen);
  }
  assert.match(navigatorSource, /<Stack\.Navigator screenOptions=\{\{ headerShown: false, contentStyle: styles\.stackContent \}\}>/);
  assert.match(navigatorSource, /stackContent:\s*\{\s*backgroundColor:\s*'#0c0a17'/);
  const navigator = navigatorSource.split('export default function StaffEventsNavigator()')[1];
  assert.doesNotMatch(navigator, /<AuthBackground/);
});
