// Three pages that introduce the app, seen once: Next moves on, Skip and
// Get started finish, and either way the app remembers it was seen.
import {router} from 'expo-router';
import {Body, Button, Pager, Screen, Title} from 'expo-interface';
import {useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {onboarding} from '../store/account';

const PAGES = [
  {title: 'Welcome to Test App', body: 'Your notes, on every device you use.'},
  {title: 'Find anything', body: 'Search every note, and keep the ones you need as favourites.'},
  {title: 'Make it yours', body: 'Choose a theme, an accent and the text size in Settings.'},
];

export default function Onboarding() {
  const [page, setPage] = useState(0);
  const last = page === PAGES.length - 1;
  const finish = () => {
    onboarding.set({seen: true});
    router.replace('/sign-in');
  };
  return (
    <Screen gutter>
      <Pager page={page} onPageChange={setPage} label="Introduction" testID="onboarding-pager" style={styles.pager}>
        {PAGES.map(each => (
          <View key={each.title} style={styles.page}>
            <Title align="center">{each.title}</Title>
            <Body align="center" color="secondaryLabel">
              {each.body}
            </Body>
          </View>
        ))}
      </Pager>
      <View style={styles.actions}>
        {last ? null : <Button label="Skip" variant="text" onPress={finish} testID="onboarding-skip" />}
        <Button label={last ? 'Get started' : 'Next'} onPress={last ? finish : () => setPage(page + 1)} testID="onboarding-next" />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pager: {flex: 1},
  page: {flex: 1, justifyContent: 'center', gap: 12, padding: 24},
  actions: {flexDirection: 'row', justifyContent: 'flex-end', gap: 12, paddingVertical: 24},
});
