export interface User {
  id: string;
  username: string;
  last_seen?: string;
}

export interface Message {
  id: string;
  sender_id: string;
  receiver_id?: string;
  group_id?: string;
  content: string;
  created_at: string;
  sender?: User;
}

export interface Group {
  id: string;
  name: string;
  created_at: string;
}

export interface GroupMember {
  group_id: string;
  user_id: string;
}
