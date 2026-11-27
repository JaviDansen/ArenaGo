import { RefreshControl, StyleSheet, Text, View } from 'react-native';
import AdminLiveScreen from './components/AdminLiveScreen';
import AdminNotice from './components/AdminNotice';
import AdminButton from './components/AdminButton';
import { AdminIcon, liveColors as c, liveStyles as s } from './components/AdminLiveUI';
import { adminEventPhases, formatAdminDate } from '../../services/adminEventsService';
import useAdminBi from './useAdminBi';
export function formatBiDuration(seconds) {
  if(seconds===null)return 'Sem população elegível';
  const minutes=Math.floor(seconds/60);
  return minutes>=60?`${Math.floor(minutes/60)}h ${minutes%60}min`:`${minutes}min`;
}
function Bar({label,percent,detail}) {
  return <View style={styles.barRow}><Text style={s.body}>{label}</Text><View style={styles.track}>
    <View style={[styles.fill,{width:`${percent}%`}]} /></View><Text style={s.body}>{detail}</Text></View>;
}
export default function AdminEventBiScreen({navigation,route,eventId:selected}) {
  const eventId=selected??route?.params?.eventId;
  const {data,pending,refreshing,error,stale,refresh}=useAdminBi(navigation,eventId);
  return <AdminLiveScreen title="BI do Evento" eyebrow="PAINEL DO EVENTO" subtitle="Acompanhe os resultados e indicadores do evento."
    navigation={navigation} backLabel="Voltar ao evento" onBack={()=>navigation.popTo('AdminRealEvent',{eventId})} showTabs
    refreshControl={<RefreshControl refreshing={Boolean(refreshing)} onRefresh={refresh} tintColor={c.accent} />}>
    {pending&&<AdminNotice title="Carregando indicadores..." />}
    {error&&<AdminNotice tone="error" title={stale?'Dados desatualizados':'BI indisponível'} message={error} />}
    <AdminButton label={refreshing?'Atualizando indicadores...':'Atualizar indicadores'} onPress={refresh} disabled={Boolean(refreshing)} variant="secondary" />
    {data&&<>
      <View style={[s.card,s.row]}><AdminIcon name="calendar" /><View style={s.grow}><Text style={s.title}>{data.event.name}</Text>
        <Text style={s.body}>{adminEventPhases[data.event.effectivePhase]}</Text><Text style={s.body}>
          {data.event.effectivePhase==='closed'?'Resultados de evento encerrado':'Resultados parciais · atualização periódica'}</Text></View></View>
      <Text style={styles.heading}>VISÃO GERAL</Text><View style={styles.grid}>
        {[['Participações registradas','participations'],['Entradas na Arena','arenaEntries'],['Atendimentos concluídos','completed'],['Ausências registradas','absent']].map(([label,key])=>
          <View key={key} style={[s.card,styles.metric]}><Text style={styles.number}>{data.overview[key]}</Text><Text style={s.body}>{label}</Text></View>)}
      </View>
      {data.overview.participations===0&&<AdminNotice title="Evento sem participações" />}
      <View style={s.card}><Text style={s.title}>Experiências mais utilizadas</Text><Text style={s.body}>Ranking por atendimentos concluídos</Text>
        {!data.ranking.length?<Text style={s.body}>Sem atendimentos concluídos.</Text>:data.ranking.map(r=><Bar key={r.id} label={r.name} percent={r.percent} detail={`${r.completed} · ${r.percent.toFixed(1)}%`} />)}</View>
      <View style={s.card}><Text style={s.title}>☆ Avaliações</Text><Text style={styles.number}>{data.ratings.mean===null?'Sem avaliações':`${data.ratings.mean.toFixed(1)} / 5`}</Text>
        <Text style={s.body}>{data.ratings.count} avaliações</Text>{data.ratings.distribution.slice().reverse().map(r=><Bar key={r.stars} label={`${r.stars} estrelas`} percent={r.percent} detail={`${r.count} · ${r.percent.toFixed(1)}%`} />)}</View>
      <View style={s.card}><Text style={s.title}>Tempo de participação</Text><View style={styles.grid}>
        {[[data.durationA,'Até a última experiência concluída'],[data.durationB,'Até a saída voluntária']].map(([metric,label])=><View key={label} style={styles.duration}>
          <Text style={s.body}>{label}</Text><Text style={styles.durationValue}>{formatBiDuration(metric.meanSeconds)}</Text><Text style={s.body}>{metric.population} participações elegíveis</Text></View>)}
      </View></View>
      <AdminNotice title="Perfil do público indisponível" message="Divulgação de dados demográficos aguardando autorização e política de privacidade." />
      <Text style={s.body}>Última consulta: {formatAdminDate(data.observedAt,data.event.timezone)}</Text>
    </>}
  </AdminLiveScreen>;
}
const styles=StyleSheet.create({
  heading:{color:c.muted,fontWeight:'700',letterSpacing:2,marginTop:20},grid:{flexDirection:'row',flexWrap:'wrap',gap:10},
  metric:{flexGrow:1,flexBasis:'45%',minWidth:130},number:{color:c.text,fontSize:32,fontWeight:'700',marginVertical:6},
  duration:{flexGrow:1,flexBasis:'45%',minWidth:180,marginTop:12},durationValue:{color:c.text,fontSize:23,fontWeight:'700',marginVertical:8},
  barRow:{gap:6,marginTop:14},track:{backgroundColor:'#31233e',height:10,borderRadius:8,overflow:'hidden'},fill:{backgroundColor:'#a337df',height:'100%',borderRadius:8},
});
