import React, {
  Component
} from 'react';
import Box from '3box';
import PropTypes from 'prop-types';
import resolve from 'did-resolver';
import registerResolver from '3id-resolver';

import { sortChronologicallyAndGroup } from './utils';

import Launcher from './components/Launcher';
import ChatWindow from './components/ChatWindow';
import './index.scss';

class ChatBox extends Component {
  constructor(props) {
    super(props);
    const {
      agentProfile,
      showEmoji,
      currentUserAddr,
      box,
      ethereum,
      colorTheme,
      popupChat,
      mute,
      openOnMount,
    } = this.props;

    this.state = {
      agentProfile: agentProfile || {
        chatName: 'Chatbox',
        imageUrl: null
      },
      colorTheme: colorTheme || '#181F21',
      showEmoji,
      popupChat,
      isOpen: openOnMount || false,
      newMessagesCount: 0,
      updateCommentsCount: 0,
      membersOnlineLength: 1,
      mute,
      dialogue: [],
      uniqueUsers: [],
      membersOnline: [],
      thread: {},
      profiles: {},
      currentUser3BoxProfile: {},
      box,
      currentUserAddr,
      ethereum: ethereum || window.ethereum,
    }
  }

  async componentDidMount() {
    const { currentUser3BoxProfile } = this.props;

    // get ipfs instance for did-resolver
    const IPFS = await Box.getIPFS();
    registerResolver(IPFS);

    if ((!currentUser3BoxProfile || !Object.entries(currentUser3BoxProfile).length)) {
      await this.fetchMe();
    }

    this.fetchThread();
  }

  // get thread from public api only on component mount
  fetchThread = async () => {
    const { ethereum } = this.state;
    const {
      spaceName,
      threadName,
    } = this.props;

    if (!spaceName || !threadName) console.error('You must pass both spaceName and threadName props');
    if (!ethereum) console.error('Chatbox component must have ethereum provider to fully operate');

    const box = await Box.create({ ethereum });
    const thread = await box.openThread(spaceName, threadName, { ghost: true });
    const dialogue = await thread.getPosts();

    this.setState({ thread, box, dialogue }, async () => {
      await this.updateComments();
      await this.updateMembersOnline();

      thread.onUpdate(() => this.updateComments());
      thread.onNewCapabilities(() => this.updateMembersOnline());
    });
  }

  openBox = async () => {
    const {
      ethereum,
      box,
      currentUserAddr,
    } = this.state;
    const { spaceName } = this.props;

    if (!ethereum) console.error('You must provide an ethereum object to the comments component.');

    await box.auth([spaceName], { address: this.props.currentUserAddr || currentUserAddr });
    this.setState({ hasAuthed: true });

    await box.syncDone;
  }

  fetchMe = async () => {
    const { profiles, ethereum } = this.state;
    const { currentUserAddr, userProfileURL } = this.props;

    if (!ethereum) return console.error('No web3');

    let myAddress;
    if (currentUserAddr) {
      myAddress = currentUserAddr;
    } else {
      const addresses = await ethereum.enable();
      myAddress = addresses[0];
    }

    const currentUser3BoxProfile = await Box.getProfile(myAddress);
    currentUser3BoxProfile.profileURL = userProfileURL ? userProfileURL(myAddress) : `https://3box.io/${myAddress}`;
    currentUser3BoxProfile.ethAddr = myAddress;

    profiles[myAddress] = currentUser3BoxProfile;

    this.setState({ currentUser3BoxProfile, profiles, currentUserAddr: myAddress });
  }

  // get profiles of commenters from public api only on component mount
  fetchProfiles = async (uniqueUsers) => {
    const { profiles, currentUser3BoxProfile, currentUserAddr } = this.state;

    const profilesToUpdate = uniqueUsers.filter((did, i) => !profiles[uniqueUsers[i]]);

    if (!profilesToUpdate.length) return;

    const fetchProfile = async (did) => await Box.getProfile(did);
    const fetchAllProfiles = async () => await Promise.all(profilesToUpdate.map(did => fetchProfile(did)));
    const profilesArray = await fetchAllProfiles();

    const getEthAddr = async (did) => await resolve(did);
    const getAllEthAddr = async () => await Promise.all(profilesToUpdate.map(did => getEthAddr(did)));
    const ethAddrArray = await getAllEthAddr();

    profilesArray.forEach((profile, i) => {
      const { userProfileURL } = this.props;
      const ethAddr = ethAddrArray[i].publicKey[2].ethereumAddress;
      profile.ethAddr = ethAddr;
      profile.profileURL = userProfileURL ? userProfileURL(ethAddr) : `https://3box.io/${ethAddr}`;
      profiles[profilesToUpdate[i]] = profile;
    });

    if (currentUserAddr) profiles[currentUserAddr] = currentUser3BoxProfile;

    this.setState({
      profiles,
    });
  }

  updateComments = async () => {
    const {
      thread,
      uniqueUsers,
      newMessagesCount,
      dialogueLength,
      updateCommentsCount,
    } = this.state;

    if (!thread) return;

    const updatedUnsortedDialogue = await thread.getPosts();
    const newDialogueLength = updatedUnsortedDialogue.length;
    const updatedDialogue = sortChronologicallyAndGroup(updatedUnsortedDialogue);

    // if there are new messagers, fetch their profiles
    const updatedUniqueUsers = [...new Set(updatedUnsortedDialogue.map(x => x.author))];

    // count new messages for when popup closed
    const numNewMessages = newDialogueLength - dialogueLength;
    let totalNewMessages = newMessagesCount;
    totalNewMessages += numNewMessages;
    if (uniqueUsers.length === updatedUniqueUsers.length) {
      this.setState({
        dialogue: updatedDialogue,
        newMessagesCount: totalNewMessages || 0,
        dialogueLength: newDialogueLength,
      });
    } else {
      await this.fetchProfiles(updatedUniqueUsers);
      this.setState({
        dialogue: updatedDialogue,
        newMessagesCount: totalNewMessages || 0,
        dialogueLength: newDialogueLength,
        uniqueUsers: updatedUniqueUsers
      });
    }

    this.setState({ updateCommentsCount: updateCommentsCount + 1 });
  }

  updateMembersOnline = async () => {
    const { thread, currentUserAddr } = this.state;

    const updatedMembersOnline = await thread.listMembers();

    await this.fetchProfiles(updatedMembersOnline);
    if (currentUserAddr) updatedMembersOnline.push(currentUserAddr);

    this.setState({
      membersOnline: updatedMembersOnline,
      membersOnlineLength: updatedMembersOnline.length,
    });
  }

  handleClick = () => {
    this.setState({
      isOpen: !this.state.isOpen,
      newMessagesCount: 0
    });
  }

  postMessage = async (message) => {
    const { hasAuthed, ethereum } = this.state;

    if (!ethereum) return;

    try {
      if (!hasAuthed) await this.openBox();
      await this.state.thread.post(message.data.text || message.data.emoji);
      await this.updateComments();
    } catch (error) {
      console.error('There was an error saving your message', error);
    }
  }

  render() {
    const {
      dialogue,
      currentUserAddr,
      profiles,
      currentUser3BoxProfile,
      agentProfile,
      colorTheme,
      showEmoji,
      popupChat,
      newMessagesCount,
      mute,
      membersOnlineLength,
      ethereum,
      box,
      membersOnline,
    } = this.state;
    const { loginFunction, userProfileURL, } = this.props;

    const noWeb3 = !box && !loginFunction && !ethereum;
    const isOpen = this.props.hasOwnProperty('isOpen') ? this.props.isOpen : this.state.isOpen;

    if (popupChat) {
      return (
        <Launcher
          postMessage={this.postMessage}
          handleClick={this.handleClick}
          resetNewMessageCounter={this.resetNewMessageCounter}
          agentProfile={agentProfile}
          loginFunction={loginFunction}
          messageList={dialogue}
          showEmoji={showEmoji}
          currentUserAddr={currentUserAddr}
          currentUser3BoxProfile={currentUser3BoxProfile}
          profiles={profiles}
          colorTheme={colorTheme}
          isOpen={isOpen}
          newMessagesCount={newMessagesCount}
          mute={mute}
          membersOnlineLength={membersOnlineLength}
          membersOnline={membersOnline}
          ethereum={ethereum}
          noWeb3={noWeb3}
          popupChat={popupChat}
          box={box}
          userProfileURL={userProfileURL}
        />
      );
    }

    return (
      <ChatWindow
        postMessage={this.postMessage}
        messageList={dialogue}
        agentProfile={agentProfile}
        loginFunction={loginFunction}
        isOpen={isOpen}
        showEmoji={showEmoji}
        profiles={profiles}
        currentUser3BoxProfile={currentUser3BoxProfile}
        currentUserAddr={currentUserAddr}
        colorTheme={colorTheme}
        mute={mute}
        membersOnlineLength={membersOnlineLength}
        membersOnline={membersOnline}
        ethereum={ethereum}
        noWeb3={noWeb3}
        userProfileURL={userProfileURL}
        box={box}
        popupChat={false}
        notPopup
      />
    )
  }
}

ChatBox.propTypes = {
  chatName: PropTypes.string,
  colorTheme: PropTypes.string,
  popupChat: PropTypes.bool,
  mute: PropTypes.bool,
  currentUserAddr: PropTypes.string,
  userProfileURL: PropTypes.func,
  loginFunction: PropTypes.func,
  box: PropTypes.object,
  spaceOpts: PropTypes.object,
  agentProfile: PropTypes.object,
  ethereum: PropTypes.object,
  threadOpts: PropTypes.object,
  currentUser3BoxProfile: PropTypes.object,
  spaceName: PropTypes.string.isRequired,
  threadName: PropTypes.string.isRequired,
  showEmoji: PropTypes.bool,
  openOnMount: PropTypes.bool,
  isOpen: PropTypes.bool,
};

ChatBox.defaultProps = {
  chatName: '',
  currentUserAddr: '',
  agentProfile: null,
  userProfileURL: null,
  box: null,
  ethereum: null,
  currentUser3BoxProfile: null,
  threadOpts: null,
  spaceOpts: null,
  loginFunction: null,
  showEmoji: true,
  openOnMount: true,
};

export default ChatBox;