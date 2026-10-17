import {useState} from 'react';
import {Image, Platform, Pressable, Switch, Text, TextInput, View} from 'react-native';
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

/** Two buttons that say when the pointer comes over one, and count each time it leaves. */
function Hovered() {
  const [over, setOver] = useState('nothing');
  const [left, setLeft] = useState(0);
  const item = (name: string) => (
    <Pressable accessibilityRole="button" onHoverIn={() => setOver(name)} onHoverOut={() => setLeft(count => count + 1)}>
      <Text>{name}</Text>
    </Pressable>
  );
  return (
    <View>
      {item('Share')}
      {item('Delete')}
      <Text testID="over">
        Over {over}, left {left}
      </Text>
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

  it('finds an image by its text alternative on every platform, and nothing by a title, which only a page gives', async () => {
    await render(<Image accessibilityLabel="Logo" source={{uri: 'https://example.com/logo.png'}} style={{width: 32, height: 32}}/>);
    await expect(screen.getByAltText('Logo')).toBeVisible();
    expect(await screen.queryByTitle('Logo')).toBeNull();
  });

  it('hovers on every platform, the pointer leaving what it was over for the next', async () => {
    await render(<Hovered/>);
    expect(await screen.getByRole('button', {name: 'Share'}).hover()).toBe('done');
    await expect(screen.getByTestId('over')).toHaveText('Over Share, left 0');
    await screen.getByRole('button', {name: 'Delete'}).hover();
    await expect(screen.getByTestId('over')).toHaveText('Over Delete, left 1');
    await screen.getByRole('button', {name: 'Delete'}).hover();
    await expect(screen.getByTestId('over')).toHaveText('Over Delete, left 1');
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
