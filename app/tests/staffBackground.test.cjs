const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const navigatorPath = path.join(__dirname, '../screens/staff/StaffEventsNavigator.js');
const navigatorSource = fs.readFileSync(navigatorPath, 'utf8');
const shellSource = fs.readFileSync(path.join(__dirname, '../screens/staff/components/StaffLiveScreen.js'), 'utf8');

test('each native Staff route renders the operational background inside its screen', () => {
  assert.match(navigatorSource, /import StaffLiveScreen from '\.\/components\/StaffLiveScreen';/);
  const eventsScreen = navigatorSource.split('function StaffEventsScreen(')[1].split('function StaffEventHomeScreen(')[0];
  const homeScreen = navigatorSource.split('function StaffEventHomeScreen(')[1].split('function StaffEventDashboard(')[0];
  for (const [screen, source, testID] of [
    ['StaffEventsScreen', eventsScreen, 'staff-events-background'],
    ['StaffEventHomeScreen', homeScreen, 'staff-event-home-background'],
  ]) {
    assert.match(source, new RegExp(`<StaffLiveScreen testID="${testID}"`), screen);
    assert.match(source, /<\/StaffLiveScreen>/, screen);
    assert.doesNotMatch(source, /<SafeAreaView|<ScrollView/, screen);
  }
  assert.match(shellSource, /<SafeAreaView style=\{styles.safe\} edges=\{\['top', 'left', 'right', 'bottom'\]\}/);
  assert.match(shellSource, /<ScrollView .*contentContainerStyle=\{styles\.content\}>/);
  assert.match(shellSource, /pointerEvents="none"/);
  assert.match(shellSource, /safe:\s*\{\s*flex: 1, backgroundColor: c\.background/);
  assert.match(navigatorSource, /<Stack\.Navigator screenOptions=\{\{ headerShown: false, contentStyle: styles\.stackContent \}\}>/);
  assert.match(navigatorSource, /stackContent:\s*\{\s*backgroundColor: c\.background/);
  const navigator = navigatorSource.split('export default function StaffEventsNavigator()')[1];
  assert.doesNotMatch(navigator, /<StaffLiveScreen/);
});
