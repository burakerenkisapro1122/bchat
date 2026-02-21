import React, { useState, useEffect, useRef } from 'react';
import { supabase } from './lib/supabase';
import { User, Message, Group } from './types';
import { 
  Send, 
  Plus, 
  Users, 
  MessageSquare, 
  LogOut, 
  Search,
  Hash,
  User as UserIcon,
  ChevronRight,
  Loader2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format } from 'date-fns';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [usernameInput, setUsernameInput] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  
  const [activeTab, setActiveTab] = useState<'chats' | 'groups'>('chats');
  const [users, setUsers] = useState<User[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [activeChat, setActiveChat] = useState<{ type: 'user' | 'group', id: string } | null>(null);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');

  // Clear unread count when chat becomes active
  useEffect(() => {
    if (activeChat) {
      setUnreadCounts(prev => ({
        ...prev,
        [activeChat.id]: 0
      }));
    }
  }, [activeChat]);

  // Global message subscription for unread indicators
  useEffect(() => {
    if (!currentUser) return;

    const globalMessageSub = supabase.channel('global:messages')
      .on('postgres_changes', 
        { 
          event: 'INSERT', 
          schema: 'public', 
          table: 'messages'
        }, 
        (payload) => {
          const msg = payload.new as Message;
          
          // Ignore messages sent by current user
          if (msg.sender_id === currentUser.id) return;

          // Determine the chat ID (either sender_id for direct or group_id for group)
          const chatId = msg.group_id || msg.sender_id;

          // If message is for the active chat, we don't need an unread indicator
          if (activeChat?.id === chatId) return;

          // Check if message is relevant to current user (direct message to me or group message)
          const isRelevant = msg.group_id || msg.receiver_id === currentUser.id;
          if (!isRelevant) return;

          setUnreadCounts(prev => ({
            ...prev,
            [chatId]: (prev[chatId] || 0) + 1
          }));
        }
      )
      .subscribe();

    return () => {
      globalMessageSub.unsubscribe();
    };
  }, [currentUser, activeChat]);
  
  const [isNewChatModalOpen, setIsNewChatModalOpen] = useState(false);
  const [isNewGroupModalOpen, setIsNewGroupModalOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Check for stored user
  useEffect(() => {
    const storedUser = localStorage.getItem('chat_user');
    if (storedUser) {
      setCurrentUser(JSON.parse(storedUser));
    }
  }, []);

  // Fetch users and groups
  useEffect(() => {
    if (!currentUser) return;

    const fetchData = async () => {
      const { data: userData } = await supabase.from('users').select('*').neq('id', currentUser.id);
      if (userData) setUsers(userData);

      const { data: groupData } = await supabase.from('groups').select('*');
      if (groupData) setGroups(groupData);
    };

    fetchData();

    // Subscribe to users and groups changes
    const userSub = supabase.channel('public:users')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, fetchData)
      .subscribe();

    const groupSub = supabase.channel('public:groups')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'groups' }, fetchData)
      .subscribe();

    return () => {
      userSub.unsubscribe();
      groupSub.unsubscribe();
    };
  }, [currentUser]);

  // Fetch messages for active chat
  useEffect(() => {
    if (!currentUser || !activeChat) return;

    const fetchMessages = async () => {
      let query = supabase.from('messages').select('*, sender:users(*)');
      
      if (activeChat.type === 'user') {
        query = query.or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${activeChat.id}),and(sender_id.eq.${activeChat.id},receiver_id.eq.${currentUser.id})`);
      } else {
        query = query.eq('group_id', activeChat.id);
      }

      const { data } = await query.order('created_at', { ascending: true });
      if (data) setMessages(data);
    };

    fetchMessages();

    // Subscribe to new messages
    const messageSub = supabase.channel(`chat:${activeChat.id}`)
      .on('postgres_changes', 
        { 
          event: 'INSERT', 
          schema: 'public', 
          table: 'messages',
          filter: activeChat.type === 'group' 
            ? `group_id=eq.${activeChat.id}` 
            : undefined
        }, 
        async (payload) => {
          const newMessage = payload.new as Message;
          
          // For 1-on-1, filter manually if needed (Supabase filter is limited)
          if (activeChat.type === 'user') {
            const isRelevant = 
              (newMessage.sender_id === currentUser.id && newMessage.receiver_id === activeChat.id) ||
              (newMessage.sender_id === activeChat.id && newMessage.receiver_id === currentUser.id);
            
            if (!isRelevant) return;
          }

          // Fetch sender info
          const { data: sender } = await supabase.from('users').select('*').eq('id', newMessage.sender_id).single();
          setMessages(prev => [...prev, { ...newMessage, sender }]);
        }
      )
      .subscribe();

    return () => {
      messageSub.unsubscribe();
    };
  }, [currentUser, activeChat]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usernameInput.trim()) return;

    setIsLoggingIn(true);
    try {
      // Find or create user
      const { data: existingUser } = await supabase
        .from('users')
        .select('*')
        .eq('username', usernameInput.trim())
        .single();

      if (existingUser) {
        setCurrentUser(existingUser);
        localStorage.setItem('chat_user', JSON.stringify(existingUser));
      } else {
        const { data: newUser, error } = await supabase
          .from('users')
          .insert([{ username: usernameInput.trim() }])
          .select()
          .single();

        if (error) throw error;
        if (newUser) {
          setCurrentUser(newUser);
          localStorage.setItem('chat_user', JSON.stringify(newUser));
        }
      }
    } catch (error) {
      console.error('Login error:', error);
      alert('Failed to login. Make sure Supabase is configured.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem('chat_user');
    setActiveChat(null);
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !currentUser || !activeChat) return;

    const messageData: any = {
      sender_id: currentUser.id,
      content: newMessage.trim(),
    };

    if (activeChat.type === 'user') {
      messageData.receiver_id = activeChat.id;
    } else {
      messageData.group_id = activeChat.id;
    }

    setNewMessage('');
    const { error } = await supabase.from('messages').insert([messageData]);
    if (error) {
      console.error('Send error:', error);
      alert('Failed to send message');
    }
  };

  const createGroup = async () => {
    if (!newGroupName.trim() || !currentUser) return;

    const { data: group, error } = await supabase
      .from('groups')
      .insert([{ name: newGroupName.trim() }])
      .select()
      .single();

    if (error) {
      alert('Failed to create group');
      return;
    }

    if (group) {
      // Add creator to group members
      await supabase.from('group_members').insert([{ group_id: group.id, user_id: currentUser.id }]);
      setGroups(prev => [...prev, group]);
      setIsNewGroupModalOpen(false);
      setNewGroupName('');
      setActiveChat({ type: 'group', id: group.id });
    }
  };

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-[#F5F5F0] flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-white rounded-[32px] p-10 shadow-xl shadow-black/5"
        >
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 bg-[#5A5A40] rounded-2xl flex items-center justify-center mb-4">
              <MessageSquare className="text-white w-8 h-8" />
            </div>
            <h1 className="text-3xl font-serif font-medium text-[#1A1A1A]">Welcome back</h1>
            <p className="text-[#5A5A40]/60 mt-2">Enter your username to start chatting</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <label className="block text-xs uppercase tracking-widest font-semibold text-[#5A5A40]/50 mb-2 ml-1">
                Username
              </label>
              <input
                type="text"
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                placeholder="e.g. alex_smith"
                className="w-full px-6 py-4 bg-[#F5F5F0] border-none rounded-2xl focus:ring-2 focus:ring-[#5A5A40] transition-all outline-none text-[#1A1A1A]"
                required
              />
            </div>
            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full py-4 bg-[#5A5A40] text-white rounded-2xl font-medium hover:bg-[#4A4A30] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isLoggingIn ? <Loader2 className="animate-spin w-5 h-5" /> : 'Join Chat'}
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-[#F5F5F0]">
            <p className="text-xs text-center text-[#5A5A40]/40 leading-relaxed">
              By joining, you agree to our community guidelines. <br />
              All messages are real-time.
            </p>
          </div>
        </motion.div>
      </div>
    );
  }

  const activeChatInfo = activeChat?.type === 'user' 
    ? users.find(u => u.id === activeChat.id)
    : groups.find(g => g.id === activeChat.id);

  return (
    <div className="h-screen bg-[#F5F5F0] flex overflow-hidden">
      {/* Sidebar */}
      <div className="w-80 bg-white border-r border-[#E5E5E0] flex flex-col">
        <div className="p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#5A5A40] rounded-xl flex items-center justify-center">
              <MessageSquare className="text-white w-5 h-5" />
            </div>
            <span className="font-serif font-medium text-xl">Chat</span>
          </div>
          <button 
            onClick={handleLogout}
            className="p-2 text-[#5A5A40]/40 hover:text-[#5A5A40] transition-colors"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 mb-6">
          <div className="flex bg-[#F5F5F0] p-1 rounded-xl">
            <button
              onClick={() => setActiveTab('chats')}
              className={cn(
                "flex-1 py-2 text-sm font-medium rounded-lg transition-all",
                activeTab === 'chats' ? "bg-white shadow-sm text-[#1A1A1A]" : "text-[#5A5A40]/60 hover:text-[#5A5A40]"
              )}
            >
              Chats
            </button>
            <button
              onClick={() => setActiveTab('groups')}
              className={cn(
                "flex-1 py-2 text-sm font-medium rounded-lg transition-all",
                activeTab === 'groups' ? "bg-white shadow-sm text-[#1A1A1A]" : "text-[#5A5A40]/60 hover:text-[#5A5A40]"
              )}
            >
              Groups
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 space-y-1">
          {activeTab === 'chats' ? (
            <>
              {users.map(user => (
                <button
                  key={user.id}
                  onClick={() => setActiveChat({ type: 'user', id: user.id })}
                  className={cn(
                    "w-full flex items-center gap-3 p-3 rounded-2xl transition-all group",
                    activeChat?.id === user.id ? "bg-[#5A5A40] text-white" : "hover:bg-[#F5F5F0] text-[#1A1A1A]"
                  )}
                >
                  <div className={cn(
                    "w-12 h-12 rounded-xl flex items-center justify-center text-lg font-medium",
                    activeChat?.id === user.id ? "bg-white/20" : "bg-[#F5F5F0]"
                  )}>
                    {user.username[0].toUpperCase()}
                  </div>
                  <div className="flex-1 text-left">
                    <div className="font-medium truncate">{user.username}</div>
                    <div className={cn(
                      "text-xs truncate",
                      activeChat?.id === user.id ? "text-white/60" : "text-[#5A5A40]/40"
                    )}>
                      Click to chat
                    </div>
                  </div>
                  {unreadCounts[user.id] > 0 && (
                    <div className="w-5 h-5 bg-[#FF4444] text-white text-[10px] font-bold rounded-full flex items-center justify-center animate-pulse">
                      {unreadCounts[user.id]}
                    </div>
                  )}
                </button>
              ))}
              {users.length === 0 && (
                <div className="text-center py-10 text-[#5A5A40]/40 text-sm">
                  No other users yet
                </div>
              )}
            </>
          ) : (
            <>
              {groups.map(group => (
                <button
                  key={group.id}
                  onClick={() => setActiveChat({ type: 'group', id: group.id })}
                  className={cn(
                    "w-full flex items-center gap-3 p-3 rounded-2xl transition-all group",
                    activeChat?.id === group.id ? "bg-[#5A5A40] text-white" : "hover:bg-[#F5F5F0] text-[#1A1A1A]"
                  )}
                >
                  <div className={cn(
                    "w-12 h-12 rounded-xl flex items-center justify-center text-lg font-medium",
                    activeChat?.id === group.id ? "bg-white/20" : "bg-[#F5F5F0]"
                  )}>
                    <Hash className="w-5 h-5" />
                  </div>
                  <div className="flex-1 text-left">
                    <div className="font-medium truncate">{group.name}</div>
                    <div className={cn(
                      "text-xs truncate",
                      activeChat?.id === group.id ? "text-white/60" : "text-[#5A5A40]/40"
                    )}>
                      Group Chat
                    </div>
                  </div>
                  {unreadCounts[group.id] > 0 && (
                    <div className="w-5 h-5 bg-[#FF4444] text-white text-[10px] font-bold rounded-full flex items-center justify-center animate-pulse">
                      {unreadCounts[group.id]}
                    </div>
                  )}
                </button>
              ))}
              <button
                onClick={() => setIsNewGroupModalOpen(true)}
                className="w-full flex items-center gap-3 p-3 rounded-2xl border-2 border-dashed border-[#E5E5E0] text-[#5A5A40]/40 hover:border-[#5A5A40]/40 hover:text-[#5A5A40] transition-all"
              >
                <div className="w-12 h-12 rounded-xl flex items-center justify-center">
                  <Plus className="w-5 h-5" />
                </div>
                <span className="font-medium">Create Group</span>
              </button>
            </>
          )}
        </div>

        <div className="p-6 border-t border-[#E5E5E0] bg-[#F5F5F0]/30">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#5A5A40]/10 rounded-xl flex items-center justify-center text-[#5A5A40]">
              <UserIcon className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm truncate text-[#1A1A1A]">{currentUser.username}</div>
              <div className="text-[10px] uppercase tracking-wider font-bold text-[#5A5A40]/40">Online</div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col bg-white relative">
        {activeChat ? (
          <>
            {/* Chat Header */}
            <div className="h-20 px-8 border-bottom border-[#E5E5E0] flex items-center justify-between bg-white z-10">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-[#F5F5F0] rounded-xl flex items-center justify-center text-xl font-medium text-[#5A5A40]">
                  {activeChat.type === 'user' ? (activeChatInfo as User)?.username[0].toUpperCase() : <Hash className="w-6 h-6" />}
                </div>
                <div>
                  <h2 className="font-serif text-xl font-medium text-[#1A1A1A]">
                    {activeChat.type === 'user' ? (activeChatInfo as User)?.username : (activeChatInfo as Group)?.name}
                  </h2>
                  <p className="text-xs text-[#5A5A40]/40">
                    {activeChat.type === 'user' ? 'Direct Message' : 'Group Channel'}
                  </p>
                </div>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-8 space-y-6 bg-[#F5F5F0]/20">
              {messages.map((msg, idx) => {
                const isMe = msg.sender_id === currentUser.id;
                const showSender = activeChat.type === 'group' && !isMe;
                
                return (
                  <div 
                    key={msg.id} 
                    className={cn(
                      "flex flex-col",
                      isMe ? "items-end" : "items-start"
                    )}
                  >
                    {showSender && (
                      <span className="text-[10px] font-bold text-[#5A5A40]/40 uppercase tracking-wider mb-1 ml-1">
                        {msg.sender?.username}
                      </span>
                    )}
                    <div className={cn(
                      "max-w-[70%] px-5 py-3 rounded-2xl text-sm leading-relaxed shadow-sm",
                      isMe 
                        ? "bg-[#5A5A40] text-white rounded-tr-none" 
                        : "bg-white text-[#1A1A1A] rounded-tl-none border border-[#E5E5E0]"
                    )}>
                      {msg.content}
                    </div>
                    <span className="text-[10px] text-[#5A5A40]/30 mt-1 px-1">
                      {format(new Date(msg.created_at), 'HH:mm')}
                    </span>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-8 bg-white">
              <form 
                onSubmit={sendMessage}
                className="flex items-center gap-4 bg-[#F5F5F0] p-2 rounded-[24px] focus-within:ring-2 focus-within:ring-[#5A5A40]/20 transition-all"
              >
                <input
                  type="text"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Type a message..."
                  className="flex-1 bg-transparent border-none px-4 py-2 outline-none text-[#1A1A1A]"
                />
                <button
                  type="submit"
                  disabled={!newMessage.trim()}
                  className="w-12 h-12 bg-[#5A5A40] text-white rounded-2xl flex items-center justify-center hover:bg-[#4A4A30] transition-all disabled:opacity-50 disabled:hover:bg-[#5A5A40]"
                >
                  <Send className="w-5 h-5" />
                </button>
              </form>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <div className="w-24 h-24 bg-[#F5F5F0] rounded-[32px] flex items-center justify-center mb-6">
              <MessageSquare className="text-[#5A5A40]/20 w-12 h-12" />
            </div>
            <h2 className="text-2xl font-serif font-medium text-[#1A1A1A]">Your conversation starts here</h2>
            <p className="text-[#5A5A40]/40 mt-2 max-w-xs">
              Select a user from the sidebar or create a group to start chatting in real-time.
            </p>
            <div className="mt-8 flex gap-4">
              <button 
                onClick={() => setActiveTab('chats')}
                className="px-6 py-3 bg-[#5A5A40] text-white rounded-xl text-sm font-medium hover:bg-[#4A4A30] transition-all"
              >
                Find Users
              </button>
              <button 
                onClick={() => { setActiveTab('groups'); setIsNewGroupModalOpen(true); }}
                className="px-6 py-3 bg-white border border-[#E5E5E0] text-[#5A5A40] rounded-xl text-sm font-medium hover:bg-[#F5F5F0] transition-all"
              >
                Create Group
              </button>
            </div>
          </div>
        )}
      </div>

      {/* New Group Modal */}
      <AnimatePresence>
        {isNewGroupModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md bg-white rounded-[32px] p-10 shadow-2xl"
            >
              <h2 className="text-2xl font-serif font-medium text-[#1A1A1A] mb-2">Create a Group</h2>
              <p className="text-[#5A5A40]/60 mb-8 text-sm">Give your group a name to get started.</p>
              
              <div className="space-y-6">
                <div>
                  <label className="block text-xs uppercase tracking-widest font-semibold text-[#5A5A40]/50 mb-2 ml-1">
                    Group Name
                  </label>
                  <input
                    type="text"
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    placeholder="e.g. Design Team"
                    className="w-full px-6 py-4 bg-[#F5F5F0] border-none rounded-2xl focus:ring-2 focus:ring-[#5A5A40] transition-all outline-none text-[#1A1A1A]"
                    autoFocus
                  />
                </div>
                <div className="flex gap-4">
                  <button
                    onClick={() => setIsNewGroupModalOpen(false)}
                    className="flex-1 py-4 bg-[#F5F5F0] text-[#5A5A40] rounded-2xl font-medium hover:bg-[#E5E5E0] transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={createGroup}
                    disabled={!newGroupName.trim()}
                    className="flex-1 py-4 bg-[#5A5A40] text-white rounded-2xl font-medium hover:bg-[#4A4A30] transition-all disabled:opacity-50"
                  >
                    Create
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Help Overlay (Schema Info) */}
      <div className="fixed bottom-6 right-6 z-40">
        <button 
          onClick={() => alert(`
            Supabase Schema Required:
            
            1. Table: users
               - id: uuid (primary key, default: gen_random_uuid())
               - username: text (unique)
               - last_seen: timestamp
            
            2. Table: groups
               - id: uuid (primary key, default: gen_random_uuid())
               - name: text
               - created_at: timestamp
            
            3. Table: messages
               - id: uuid (primary key, default: gen_random_uuid())
               - sender_id: uuid (references users.id)
               - receiver_id: uuid (references users.id, nullable)
               - group_id: uuid (references groups.id, nullable)
               - content: text
               - created_at: timestamp (default: now())
            
            4. Table: group_members
               - group_id: uuid (references groups.id)
               - user_id: uuid (references users.id)
               - primary key (group_id, user_id)
            
            Enable Realtime for 'messages', 'users', and 'groups' tables in Supabase Dashboard.
          `)}
          className="w-10 h-10 bg-white border border-[#E5E5E0] rounded-full flex items-center justify-center text-[#5A5A40]/40 hover:text-[#5A5A40] shadow-sm transition-all"
        >
          ?
        </button>
      </div>
    </div>
  );
}
