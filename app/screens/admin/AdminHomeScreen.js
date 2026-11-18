import { Pressable, StyleSheet, Text, View } from 'react-native';
import AdminLiveScreen from './components/AdminLiveScreen';
import { AdminIcon, AdminIconTile, AdminPendingActions, liveColors as c, liveStyles as s } from './components/AdminLiveUI';

export default function AdminHomeScreen({ navigation }) {
  return <AdminLiveScreen title="Painel Administrativo" subtitle="Gerencie eventos, equipe e indicadores da plataforma.">
    <View style={s.card}>
      <Pressable accessibilityRole="button" accessibilityLabel="Gerenciar eventos"
        onPress={() => navigation.navigate('AdminEvents')} style={({ pressed }) => [s.row, styles.mainLink, pressed && styles.pressed]}>
        <AdminIconTile name="calendar" />
        <View style={s.grow}><Text style={s.title}>Gerenciar eventos</Text><Text style={s.body}>Consulte e acompanhe os eventos ativos.</Text></View>
        <AdminIcon name="chevron" color={c.muted} size={18} />
      </Pressable>
      <AdminPendingActions />
    </View>
    <View style={styles.columns}>
      {[
        ['Histórico de eventos', 'Consulte eventos encerrados e resultados.', 'chart', 'Histórico'],
        ['Visão geral', 'Acompanhe indicadores agregados da plataforma.', 'gauge', 'BI'],
      ].map(([title, description, icon, route]) => <Pressable key={route} accessibilityRole="button" accessibilityLabel={title}
        onPress={() => navigation.navigate(route)} style={({ pressed }) => [s.card, styles.column, pressed && styles.pressed]}>
        <View style={styles.cardHeading}><AdminIconTile name={icon} /><AdminIcon name="chevron" color={c.muted} size={18} /></View>
        <Text style={[s.title, styles.columnTitle]}>{title}</Text><Text style={s.body}>{description}</Text>
        <Text style={s.pending}>Em breve</Text>
      </Pressable>)}
    </View>
    <View style={[s.card, s.row]} accessible accessibilityLabel="Usuários e permissões · Em implementação">
      <AdminIconTile name="users" /><View style={s.grow}>
        <Text style={s.title}>Usuários e permissões</Text><Text style={s.body}>Administre acessos e papéis de administradores globais.</Text>
        <Text style={s.pending}>Em breve</Text>
      </View>
    </View>
    <View style={[s.card, styles.notice]}><AdminIcon name="info" color={c.muted} />
      <View style={s.grow}><Text style={[s.title, { fontSize: 17 }]}>Acesso restrito</Text>
        <Text style={s.body}>Somente administradores autorizados podem alterar eventos, permissões e dados operacionais.</Text></View>
    </View>
  </AdminLiveScreen>;
}
const styles = StyleSheet.create({
  mainLink: { minHeight: 64, paddingBottom: 14 }, pressed: { opacity: 0.75 },
  columns: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 }, column: { flexGrow: 1, flexBasis: '45%', minWidth: 145 },
  cardHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  columnTitle: { marginTop: 12, fontSize: 18, lineHeight: 24 },
  notice: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', borderColor: '#795395' },
});
