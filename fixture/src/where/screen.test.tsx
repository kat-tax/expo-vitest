import {useState} from 'react';
import {Platform, Pressable, Switch, Text, TextInput, View} from 'react-native';
import {device, render, screen, within} from 'expo-vitest';

function Settings() {
  const [name, setName] = useState('');
  const [newsletter, setNewsletter] = useState(false);
  const [saved, setSaved] = useState(false);
  return (
    <View>
      <TextInput accessibilityLabel="Name" value={name} onChangeText={setName} placeholder="Your name"/>
      <Switch accessibilityLabel="Newsletter" value={newsletter} onValueChange={setNewsletter}/>
      <Pressable accessibilityRole="button" onPress={() => setSaved(true)}>
        <Text>Save</Text>
      </Pressable>
      {saved ? <Text testID="saved">Saved {name}</Text> : null}
    </View>
  );
}

function Counter() {
  const [presses, setPresses] = useState(0);
  return (
    <Pressable accessibilityRole="button" onPress={() => setPresses(count => count + 1)}>
      <Text>Pressed {presses}</Text>
    </Pressable>
  );
}

// The device's API on a rendered component: the same queries, actions,
// matchers and tree on every platform, as a device test has them.
describe('a unit test', () => {
  it('reads one tree on every platform', async () => {
    await render(<Settings/>);
    expect(await screen.tree()).toBe('textbox "Name" (value:"" placeholder:"Your name")\nswitch "Newsletter" [unchecked]\nbutton "Save"\n  text "Save"');
  });

  it('fills, checks and presses as a device test does, and waits for what follows', async () => {
    await render(<Settings/>);
    await screen.getByRole('textbox', {name: 'Name'}).fill('Ada');
    await screen.getByRole('switch', {name: 'Newsletter'}).check();
    await screen.getByRole('button', {name: 'Save'}).press();
    await expect(screen.getByTestId('saved')).toHaveText('Saved Ada');
    await expect(screen.getByRole('switch', {name: 'Newsletter'})).toBeChecked();
    await expect(within(screen.getByRole('button', {name: 'Save'})).getByText('Save')).toBeVisible();
    expect(device.platform).toBe(Platform.OS);
    expect(await screen.tree()).toMatchSnapshot();
  });

  it('presses as the first thing a test does, with nothing focused', async () => {
    await render(<Counter/>);
    await screen.getByRole('button').press();
    await expect(screen.getByRole('button')).toHaveText('Pressed 1');
  });

  it('presses twice in quick succession, as a double tap', async () => {
    await render(<Counter/>);
    await screen.getByRole('button').press({count: 2});
    await expect(screen.getByRole('button')).toHaveText('Pressed 2');
  });
});
