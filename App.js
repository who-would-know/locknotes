import React, {useCallback, useEffect, useState} from 'react';
import {
  AppState,
  FlatList,
  Modal,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

const STORAGE_KEY = 'locknotes';
const MAX_NOTES = 10; // Not for sure what is the best max list number. Setting to 10 for now
const CHANNEL_ID = 'lock-notes-v4';
const MAX_NOTE_LENGTH = 40; // Set max limit on the char for each note

// Show notifications even while the app is open
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,  // 
    shouldShowBanner: true, // make it false hide banner while in app
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

//// Local Storage of the List

async function loadNotes() {
  const raw = (await AsyncStorage.getItem(STORAGE_KEY)) ?? '[]';
  return JSON.parse(raw);
}

async function saveNotes(notes) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
}

//// Notification setup

async function setupNotifications() {
  await Notifications.requestPermissionsAsync();
  // HIGH importance so notes rank well on the lock screen (Pixel's compact 
  // view demotes lower-priority notes to icons). 
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Lock Notes',
    importance: Notifications.AndroidImportance.HIGH,
    sound: null, //null so no notification noise
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

async function showNote(note) {
  await Notifications.scheduleNotificationAsync({
    identifier: String(note.id), // lets us dismiss/update this exact one later
    content: {title: note.text, sound: false},
    trigger: {channelId: CHANNEL_ID}, // fires immediately
  });
}

async function hideNote(id) {
  await Notifications.dismissNotificationAsync(String(id));
}

// Expo can't tell us the moment a notification is swiped away, but it CAN
// list which notifications are still showing. So whenever the app opens,
// any note marked "enabled" whose notification is gone gets flipped to
// disabled automatically.
async function syncWithTray(notes) {
  const presented = await Notifications.getPresentedNotificationsAsync();
  const visibleIds = new Set(presented.map(p => p.request.identifier));
  return notes.map(n =>
    n.enabled && !visibleIds.has(String(n.id)) ? {...n, enabled: false} : n,
  );
}

//// App Start

export default function App() {
  const [notes, setNotes] = useState([]);
  const [newText, setNewText] = useState('');
  const [editing, setEditing] = useState(null);
  const [editText, setEditText] = useState('');

  const refresh = useCallback(async () => {
    const stored = await loadNotes();
    const synced = await syncWithTray(stored);
    await saveNotes(synced);
    setNotes(synced);
  }, []);

  useEffect(() => {
    setupNotifications().then(refresh);

    // Re-sync every time you come back to the app
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        refresh();
      }
    });
    return () => sub.remove();
  }, [refresh]);

  const update = async list => {
    setNotes(list);
    await saveNotes(list);
  };

  const addNote = async () => {
    const text = newText.trim();
    if (!text || notes.length >= MAX_NOTES) {
      return;
    }
    const id = Math.max(0, ...notes.map(n => n.id)) + 1;
    const note = {id, text, enabled: true};
    await update([...notes, note]);
    await showNote(note);
    setNewText('');
  };

  const toggleNote = async note => {
    const toggled = {...note, enabled: !note.enabled};
    await update(notes.map(n => (n.id === note.id ? toggled : n)));
    if (toggled.enabled) {
      await showNote(toggled);
    } else {
      await hideNote(note.id);
    }
  };

  const deleteNote = async note => {
    await hideNote(note.id);
    await update(notes.filter(n => n.id !== note.id));
  };

  const startEdit = note => {
    setEditing(note);
    setEditText(note.text);
  };

  const saveEdit = async () => {
    if (editing) {
      const text = editText.trim();
      if (text) {
        const updated = {...editing, text};
        await update(notes.map(n => (n.id === editing.id ? updated : n)));
        if (updated.enabled) {
          await showNote(updated); // refresh notification with new text
        }
      }
    }
    setEditing(null);
  };

  const atLimit = notes.length >= MAX_NOTES;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <Text style={styles.header}>Lock Notes</Text>

      <View style={styles.addRow}>
        <TextInput
          style={styles.input}
          value={newText}
          onChangeText={setNewText}
          placeholder="New note (e.g. Seat 35F)"
          maxLength={MAX_NOTE_LENGTH}
        />
        <TouchableOpacity
          style={[styles.button, atLimit && styles.buttonDisabled]}
          onPress={addNote}
          disabled={atLimit}>
          <Text style={styles.buttonText}>Add</Text>
        </TouchableOpacity>
      </View>

      // Let users know they are hitting the char length limit
      {newText.length >= MAX_NOTE_LENGTH - 5 && (
        <Text style={styles.limitText}>
          {newText.length}/{MAX_NOTE_LENGTH} characters
        </Text>
      )}


      {atLimit && (
        <Text style={styles.limitText}>
          Limit of {MAX_NOTES} notes reached — delete one to add more.
        </Text>
      )}

      <FlatList
        data={notes}
        keyExtractor={n => String(n.id)}
        contentContainerStyle={{paddingTop: 12}}
        renderItem={({item}) => (
          <View style={styles.card}>
            <Text style={styles.noteText}>{item.text}</Text>
            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={styles.button}
                onPress={() => toggleNote(item)}>
                <Text style={styles.buttonText}>
                  {item.enabled ? 'Disable' : 'Enable'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.buttonOutline}
                onPress={() => startEdit(item)}>
                <Text style={styles.buttonOutlineText}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.buttonOutline}
                onPress={() => deleteNote(item)}>
                <Text style={styles.buttonOutlineText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      />

      {/* Edit dialog */}
      <Modal visible={editing !== null} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Edit note</Text>
            <TextInput
              style={styles.input}
              value={editText}
              onChangeText={setEditText}
              autoFocus
              maxLength={MAX_NOTE_LENGTH}
            />
            <View style={styles.buttonRow}>
              <TouchableOpacity style={styles.button} onPress={saveEdit}>
                <Text style={styles.buttonText}>Save</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.buttonOutline}
                onPress={() => setEditing(null)}>
                <Text style={styles.buttonOutlineText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// CSS
const styles = StyleSheet.create({
  container: {flex: 1, padding: 16, paddingTop: 48, backgroundColor: '#fff'},
  header: {fontSize: 26, fontWeight: 'bold', marginBottom: 16},
  addRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#bbb',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  limitText: {color: '#c0392b', marginTop: 6, fontSize: 13},
  card: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    backgroundColor: '#fafafa',
  },
  noteText: {fontSize: 17, marginBottom: 10},
  buttonRow: {flexDirection: 'row', gap: 8, marginTop: 4},
  button: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
  },
  buttonDisabled: {backgroundColor: '#9db7e8'},
  buttonText: {color: '#fff', fontWeight: '600'},
  buttonOutline: {
    borderWidth: 1,
    borderColor: '#2563eb',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
  },
  buttonOutlineText: {color: '#2563eb', fontWeight: '600'},
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 24,
  },
  modalBox: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    gap: 12,
  },
  modalTitle: {fontSize: 18, fontWeight: 'bold'},
});